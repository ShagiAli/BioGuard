/**
 * Alerts: a fault reported by ward staff, from the moment it is raised
 * until an engineer picks it up.
 *
 * Every status change goes through workflow.ts rather than being written
 * here, and every query spreads alertScope(), so neither "who may do
 * this" nor "who may see this" is decided ad hoc per handler.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { alertScope, equipmentScope, requireAuth, triagesAlerts } from "../../middleware/auth.js";
import type { AlertStatus } from "@prisma/client";
import { alertNumber, canTransitionAlert } from "./workflow.js";
import { notifyAcknowledged, notifyAssigned, notifyRaised } from "./notify.js";

export const alertsRouter = Router();

/** An alert nobody has finished with. Mutable: Prisma's `notIn` requires it. */
const FINISHED: AlertStatus[] = ["RESOLVED", "CANCELLED"];

const DETAIL_INCLUDE = {
  equipment: {
    select: {
      id: true,
      name: true,
      assetNo: true,
      tag: true,
      operationalStatus: true,
      department: { select: { name: true } },
      room: { select: { code: true } },
    },
  },
  raisedBy: { select: { id: true, fullName: true } },
  acknowledgedBy: { select: { id: true, fullName: true } },
  assignedTo: { select: { id: true, fullName: true } },
  workOrder: { select: { id: true, seq: true, status: true, createdAt: true } },
} as const;

/** The stored sequence is the truth; the reference number is its presentation. */
function present<T extends { seq: number; openedAt: Date }>(alert: T) {
  return { ...alert, number: alertNumber(alert.seq, alert.openedAt) };
}

// ------------------------------------------------------------- create

const createSchema = z
  .object({
    equipmentId: z.uuid(),
    description: z.string().min(1, "Describe the problem.").max(2000),
    priority: z.enum(["EMERGENCY", "MEDIUM", "LOW"]),
  })
  .strict();

/**
 * Raise an alert.
 *
 * The device is resolved through equipmentScope first, so ward staff can
 * only report faults on equipment in their own department, and an
 * out-of-scope id is a 404 rather than a confirmation the device exists.
 */
alertsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Check the form.",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const device = await prisma.equipment.findFirst({
    where: { id: parsed.data.equipmentId, ...equipmentScope(req.user!) },
    select: { id: true, name: true, assetNo: true, operationalStatus: true },
  });
  if (!device) return res.status(404).json({ error: "Equipment not found." });

  // A retired device has left the estate. Accepting a fault report for one
  // would create work nobody intends to do.
  if (device.operationalStatus === "RETIRED") {
    return res
      .status(409)
      .json({ error: "That device is retired. Contact biomedical engineering directly." });
  }

  // Two nurses reporting the same fault is ordinary, not an error — the
  // second one is told, and may still proceed.
  const existing = await prisma.alert.findFirst({
    where: {
      equipmentId: device.id,
      status: { notIn: FINISHED },
    },
    select: { id: true, seq: true, openedAt: true },
  });

  const alert = await prisma.alert.create({
    data: {
      equipmentId: device.id,
      raisedById: req.user!.id,
      description: parsed.data.description,
      priority: parsed.data.priority,
    },
    include: DETAIL_INCLUDE,
  });

  await recordAudit({
    actorId: req.user!.id,
    action: "alert.raised",
    entity: "Alert",
    entityId: alert.id,
    after: alert,
  });

  await notifyRaised(alert);

  res.status(201).json({
    ...present(alert),
    duplicateOf: existing ? present(existing) : null,
  });
});

// --------------------------------------------------------------- read

const listQuery = z
  .object({
    status: z
      .enum(["OPEN", "ACKNOWLEDGED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CANCELLED"])
      .optional(),
    priority: z.enum(["EMERGENCY", "MEDIUM", "LOW"]).optional(),
    open: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

alertsRouter.get("/", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Unrecognised filter." });

  const { status, priority, open, page, pageSize } = parsed.data;

  const where = {
    ...alertScope(req.user!), // scope first, always
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(open === "true" ? { status: { notIn: FINISHED } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.findMany({
      where,
      // Emergencies first, then oldest, so the queue reads as a work list
      // rather than a stream.
      orderBy: [{ priority: "asc" }, { openedAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: DETAIL_INCLUDE,
    }),
  ]);

  res.json({ total, page, pageSize, rows: rows.map(present) });
});

/** Counts for the dashboard, over the same scope as the list. */
alertsRouter.get("/summary", requireAuth, async (req, res) => {
  const scope = alertScope(req.user!);
  const live = { status: { notIn: FINISHED } };

  const [open, emergency, medium, low, awaitingAssignment, inProgress] = await Promise.all([
    prisma.alert.count({ where: { ...scope, ...live } }),
    prisma.alert.count({ where: { ...scope, ...live, priority: "EMERGENCY" } }),
    prisma.alert.count({ where: { ...scope, ...live, priority: "MEDIUM" } }),
    prisma.alert.count({ where: { ...scope, ...live, priority: "LOW" } }),
    prisma.alert.count({ where: { ...scope, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.alert.count({ where: { ...scope, status: "IN_PROGRESS" } }),
  ]);

  res.json({ open, emergency, medium, low, awaitingAssignment, inProgress });
});

async function findScoped(req: Parameters<typeof requireAuth>[0], id: string) {
  return prisma.alert.findFirst({
    where: { id, ...alertScope(req.user!) },
    include: DETAIL_INCLUDE,
  });
}

alertsRouter.get("/:id", requireAuth, async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Alert not found." });

  const alert = await findScoped(req, id.data);
  if (!alert) return res.status(404).json({ error: "Alert not found." });

  res.json(present(alert));
});

/** The alert's own history, rendered by the same audit machinery as devices. */
alertsRouter.get("/:id/audit", requireAuth, async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Alert not found." });

  const alert = await findScoped(req, id.data);
  if (!alert) return res.status(404).json({ error: "Alert not found." });

  const rows = await prisma.auditLog.findMany({
    where: {
      entity: { in: ["Alert", "WorkOrder"] },
      entityId: { in: [alert.id, alert.workOrder?.id ?? alert.id] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { fullName: true } } },
  });

  res.json({ rows });
});

// -------------------------------------------------------- transitions

/**
 * Shared shape for every transition: load in scope, ask the workflow
 * whether the move is allowed, write, audit.
 */
async function transition(
  req: Parameters<typeof requireAuth>[0],
  res: Parameters<typeof requireAuth>[1],
  action: "acknowledge" | "assign" | "cancel",
  apply: (alertId: string) => Promise<unknown>
) {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Alert not found." });

  const before = await findScoped(req, id.data);
  if (!before) return res.status(404).json({ error: "Alert not found." });

  const check = canTransitionAlert(action, before.status, req.user!.role);
  if (!check.ok) {
    // 403 when the role is wrong, 409 when the moment is: they send the
    // caller to different places.
    const status = check.reason?.includes("role") ? 403 : 409;
    return res.status(status).json({ error: check.reason });
  }

  return apply(before.id);
}

alertsRouter.post("/:id/acknowledge", requireAuth, async (req, res) => {
  await transition(req, res, "acknowledge", async (alertId) => {
    const before = await prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: new Date(),
        acknowledgedById: req.user!.id,
      },
      include: DETAIL_INCLUDE,
    });

    await recordAudit({
      actorId: req.user!.id,
      action: "alert.acknowledged",
      entity: "Alert",
      entityId: alert.id,
      before,
      after: alert,
    });
    await notifyAcknowledged(alert);

    res.json(present(alert));
  });
});

const assignSchema = z.object({ engineerId: z.uuid() }).strict();

alertsRouter.post("/:id/assign", requireAuth, async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose an engineer." });

  await transition(req, res, "assign", async (alertId) => {
    const engineer = await prisma.user.findFirst({
      where: { id: parsed.data.engineerId, role: "ENGINEER", isActive: true },
      select: { id: true, fullName: true },
    });
    // Assigning to a departed or non-engineer account produces work
    // nobody will ever see.
    if (!engineer) {
      return res.status(400).json({ error: "That engineer is not available for assignment." });
    }

    const before = await prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: { status: "ASSIGNED", assignedToId: engineer.id, assignedAt: new Date() },
      include: DETAIL_INCLUDE,
    });

    await recordAudit({
      actorId: req.user!.id,
      action: "alert.assigned",
      entity: "Alert",
      entityId: alert.id,
      before,
      after: alert,
    });
    await notifyAssigned(alert, engineer.fullName);

    res.json(present(alert));
  });
});

const cancelSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

alertsRouter.post("/:id/cancel", requireAuth, async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give a reason for cancelling." });

  await transition(req, res, "cancel", async (alertId) => {
    const before = await prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: "CANCELLED",
        cancelledReason: parsed.data.reason,
        resolvedAt: new Date(),
      },
      include: DETAIL_INCLUDE,
    });

    await recordAudit({
      actorId: req.user!.id,
      action: "alert.cancelled",
      entity: "Alert",
      entityId: alert.id,
      before,
      after: alert,
    });

    res.json(present(alert));
  });
});

/** Engineers available for assignment, for the triage dropdown. */
alertsRouter.get("/meta/engineers", requireAuth, async (req, res) => {
  if (!triagesAlerts(req.user!)) {
    return res.status(403).json({ error: "Your role does not allow this action." });
  }

  const engineers = await prisma.user.findMany({
    where: { role: "ENGINEER", isActive: true },
    select: { id: true, fullName: true, department: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });

  res.json({ engineers });
});
