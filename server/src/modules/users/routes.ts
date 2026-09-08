/**
 * The people the system writes to.
 *
 * Until now accounts existed only because the seed created them, which
 * meant an address could be changed in one place: the database. For a
 * system whose whole purpose is that the right person hears about the
 * right device, "ask someone with SQL access" is not an answer.
 *
 * Passwords are deliberately absent. Nobody sets another person's
 * password here, not even an administrator — a new or corrected address
 * goes through the reset flow, so the only person who ever knows the
 * password is the person it belongs to. That also means changing
 * somebody's email hands them their account rather than taking it.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { recordAudit } from "../../lib/audit.js";

export const usersRouter = Router();

const ROLES = ["ADMIN", "MANAGER", "HEAD_OF_ALERTS", "ENGINEER", "STAFF"] as const;

/** Never includes passwordHash, and cannot be widened into doing so. */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
} as const;

const updateSchema = z
  .object({
    // Lowercased because the login lookup is exact and a capitalised
    // address would simply fail to match, silently.
    email: z.email().max(254).trim().toLowerCase().optional(),
    fullName: z.string().min(1).max(120).trim().optional(),
    role: z.enum(ROLES).optional(),
    departmentId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });

/**
 * Ordered so the list reads as an organisation rather than an alphabet:
 * who answers for the estate, then who triages, then who fixes things.
 */
const ORDER: Prisma.UserOrderByWithRelationInput[] = [{ role: "asc" }, { fullName: "asc" }];

usersRouter.get("/", requireAuth, requireRole("ADMIN", "MANAGER"), async (_req, res) => {
  const rows = await prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: ORDER });
  res.json({ rows });
});

usersRouter.patch("/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "User not found." });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Check the details.",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const target = await prisma.user.findUnique({
    where: { id: id.data },
    select: { ...PUBLIC_FIELDS, departmentId: true },
  });
  if (!target) return res.status(404).json({ error: "User not found." });

  const actor = req.user!;
  const changes = parsed.data;

  /**
   * A manager may not touch an administrator, nor make one.
   *
   * Without this the escalation is two steps and needs no password: set
   * the administrator's email to your own, ask for a reset, read the
   * link. Editing people is exactly where that has to be closed.
   */
  if (actor.role !== "ADMIN" && (target.role === "ADMIN" || changes.role === "ADMIN")) {
    return res.status(403).json({ error: "Only an administrator can manage administrators." });
  }

  // Locking yourself out is not a thing the interface should let you do
  // by accident, and it is never what was meant.
  if (target.id === actor.id) {
    if (changes.isActive === false) {
      return res.status(409).json({ error: "You cannot deactivate your own account." });
    }
    if (changes.role && changes.role !== target.role) {
      return res.status(409).json({ error: "You cannot change your own role." });
    }
  }

  /**
   * The estate must keep an administrator.
   *
   * Checked against the database rather than a count held in memory,
   * because the answer changes with every other edit in flight.
   */
  const losingAdmin =
    target.role === "ADMIN" &&
    ((changes.role && changes.role !== "ADMIN") || changes.isActive === false);

  if (losingAdmin) {
    const remaining = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: target.id } },
    });
    if (remaining === 0) {
      return res.status(409).json({ error: "This is the last active administrator." });
    }
  }

  if (changes.departmentId) {
    const exists = await prisma.department.count({ where: { id: changes.departmentId } });
    if (exists === 0) return res.status(400).json({ error: "That department does not exist." });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: changes,
      select: { ...PUBLIC_FIELDS, departmentId: true },
    });

    await recordAudit({
      actorId: actor.id,
      action: "user.updated",
      entity: "User",
      entityId: target.id,
      before: target,
      after: updated,
    });

    res.json(updated);
  } catch (err) {
    // The unique index on email is the guarantee; this turns it into an
    // answer rather than a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Another account already uses that email address." });
    }
    throw err;
  }
});
