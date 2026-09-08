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
import { generateToken, hashPassword, hashToken } from "../../lib/security.js";
import { sendMail } from "../../lib/email.js";
import { env } from "../../env.js";

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

/**
 * What a person still holds.
 *
 * Completed work is deliberately absent. A service James signed stays
 * James's for ever — that is the record an inspector reads, and moving
 * it would say somebody serviced a device before they were hired. Only
 * live obligations transfer.
 */
async function liveWork(userId: string) {
  const [devices, alerts, workOrders] = await Promise.all([
    prisma.equipment.count({
      where: { engineerId: userId, operationalStatus: { not: "RETIRED" } },
    }),
    prisma.alert.count({
      where: { assignedToId: userId, status: { notIn: ["RESOLVED", "CANCELLED"] } },
    }),
    prisma.workOrder.count({
      where: { engineerId: userId, status: { notIn: ["CLOSED", "CANCELLED"] } },
    }),
  ]);
  return { devices, alerts, workOrders, total: devices + alerts + workOrders };
}

const createSchema = z
  .object({
    email: z.email().max(254).trim().toLowerCase(),
    fullName: z.string().min(1).max(120).trim(),
    role: z.enum(ROLES),
    departmentId: z.uuid().nullable().optional(),
  })
  .strict();

const handoverSchema = z.object({ toId: z.uuid() }).strict();

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

/**
 * A new colleague.
 *
 * No password is set here. The account is created with one nobody
 * knows — random bytes, hashed, never shown — and an invitation goes out
 * on the same path a forgotten password uses. So the only person who
 * ever knows the password is the person it belongs to, and an
 * administrator cannot sign in as somebody they hired.
 */
usersRouter.post("/", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Check the details.",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const actor = req.user!;
  if (actor.role !== "ADMIN" && parsed.data.role === "ADMIN") {
    return res.status(403).json({ error: "Only an administrator can create administrators." });
  }

  if (parsed.data.departmentId) {
    const exists = await prisma.department.count({ where: { id: parsed.data.departmentId } });
    if (exists === 0) return res.status(400).json({ error: "That department does not exist." });
  }

  try {
    const created = await prisma.user.create({
      data: {
        ...parsed.data,
        departmentId: parsed.data.departmentId ?? null,
        // Unguessable and never communicated. The invitation below is
        // the only way in.
        passwordHash: await hashPassword(generateToken(32)),
      },
      select: { ...PUBLIC_FIELDS, departmentId: true },
    });

    const token = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: created.id,
        tokenHash: hashToken(token),
        // Longer than a reset: an invitation may arrive while somebody
        // is not yet at a desk, and a dead link on day one is a support
        // request rather than a security control.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      },
    });

    await sendMail({
      to: created.email,
      subject: "Your BioGuard account",
      text:
        `An account has been created for you on BioGuard.\n\n` +
        `Set your password within 7 days:\n\n` +
        `${env.APP_URL}/reset-password?token=${token}\n\n` +
        `You will sign in with this address.`,
    });

    await recordAudit({
      actorId: actor.id,
      action: "user.created",
      entity: "User",
      entityId: created.id,
      after: created,
    });

    res.status(201).json(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Another account already uses that email address." });
    }
    throw err;
  }
});

/** What would have to move before this person could be deactivated. */
usersRouter.get("/:id/workload", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "User not found." });

  const exists = await prisma.user.count({ where: { id: id.data } });
  if (exists === 0) return res.status(404).json({ error: "User not found." });

  res.json(await liveWork(id.data));
});

/**
 * Hand a leaver's live work to somebody who is staying.
 *
 * One transaction, because a half-moved handover is worse than none: the
 * devices would be watched by the new engineer while the open repair
 * still sat with a person who has gone.
 */
usersRouter.post(
  "/:id/handover",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: "User not found." });

    const parsed = handoverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose who takes this on." });
    if (parsed.data.toId === id.data) {
      return res.status(400).json({ error: "Choose somebody other than the person leaving." });
    }

    const [from, to] = await Promise.all([
      prisma.user.findUnique({ where: { id: id.data }, select: { id: true, fullName: true } }),
      prisma.user.findUnique({
        where: { id: parsed.data.toId },
        select: { id: true, fullName: true, role: true, isActive: true },
      }),
    ]);
    if (!from) return res.status(404).json({ error: "User not found." });

    // Devices, alerts and work orders all name an engineer. Handing them
    // to anybody else would put work where the application will not let
    // the recipient act on it.
    if (!to || !to.isActive || to.role !== "ENGINEER") {
      return res.status(400).json({ error: "Work can only be handed to an active engineer." });
    }

    const before = await liveWork(from.id);

    await prisma.$transaction([
      prisma.equipment.updateMany({
        where: { engineerId: from.id, operationalStatus: { not: "RETIRED" } },
        data: { engineerId: to.id },
      }),
      prisma.alert.updateMany({
        where: { assignedToId: from.id, status: { notIn: ["RESOLVED", "CANCELLED"] } },
        data: { assignedToId: to.id },
      }),
      prisma.workOrder.updateMany({
        where: { engineerId: from.id, status: { notIn: ["CLOSED", "CANCELLED"] } },
        data: { engineerId: to.id },
      }),
    ]);

    await recordAudit({
      actorId: req.user!.id,
      action: "user.handover",
      entity: "User",
      entityId: from.id,
      before: { fullName: from.fullName },
      after: { fullName: to.fullName },
    });

    res.json({ moved: before, to: { id: to.id, fullName: to.fullName } });
  }
);

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

  /**
   * Nobody leaves holding live work.
   *
   * Deactivating an engineer who still watches devices does not stop the
   * reminders — it makes them silent, addressed to somebody who has
   * gone. So the work moves first, and the refusal says how much of it
   * there is rather than only that there is some.
   */
  if (changes.isActive === false) {
    const held = await liveWork(target.id);
    if (held.total > 0) {
      const parts = [
        held.devices && `${held.devices} device${held.devices === 1 ? "" : "s"}`,
        held.alerts && `${held.alerts} open alert${held.alerts === 1 ? "" : "s"}`,
        held.workOrders && `${held.workOrders} open work order${held.workOrders === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return res.status(409).json({
        error: `Hand over their work first: ${parts.join(", ")}.`,
        workload: held,
      });
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
