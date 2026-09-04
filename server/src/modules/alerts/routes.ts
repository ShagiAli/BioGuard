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
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { EXPORT_ROW_LIMIT, orderByFrom, sendCsv, sortSchema } from "../../lib/listing.js";
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
  // Parts travel with the alert so the nurse who reported the fault can
  // see why it is taking three weeks, which was the point of asking.
  workOrder: {
    select: {
      id: true,
      seq: true,
      status: true,
      createdAt: true,
      parts: {
        select: { id: true, name: true, quantity: true, status: true, orderedAt: true },
        orderBy: { createdAt: "asc" as const },
      },
    },
  },
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

/**
 * Priority sorts by the enum, which is declared most urgent first — so
 * ascending puts emergencies at the top, which is what someone clicking
 * "Priority" wants and the opposite of what the word suggests.
 */
const SORTABLE = ["priority", "status", "openedAt"] as const;

const ALERT_ORDER: Record<
  (typeof SORTABLE)[number],
  (d: "asc" | "desc") => Prisma.AlertOrderByWithRelationInput
> = {
  priority: (d) => ({ priority: d }),
  status: (d) => ({ status: d }),
  openedAt: (d) => ({ openedAt: d }),
};

const listQuery = z
  .object({
    status: z
      .enum(["OPEN", "ACKNOWLEDGED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CANCELLED"])
      .optional(),
    priority: z.enum(["EMERGENCY", "MEDIUM", "LOW"]).optional(),
    open: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    ...sortSchema(SORTABLE),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict()
  // Both write `status` into the same where clause, so one silently
  // overwrote the other and the caller got a filter they did not ask
  // for. Saying no is better than choosing for them.
  .refine((q) => !(q.status && q.open === "true"), {
    message: "Use either a status or the unresolved filter, not both.",
  });

alertsRouter.get("/", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Unrecognised filter." });
  }

  const { status, priority, open, page, pageSize, sort, dir, format } = parsed.data;

  const where = {
    ...alertScope(req.user!), // scope first, always
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(open === "true" ? { status: { notIn: FINISHED } } : {}),
  };

  // Emergencies first, then oldest, so the queue reads as a work list
  // rather than a stream.
  const fallback = [{ priority: "asc" as const }, { openedAt: "asc" as const }];
  const orderBy = orderByFrom(sort, dir, ALERT_ORDER, fallback) as
    Prisma.AlertOrderByWithRelationInput | Prisma.AlertOrderByWithRelationInput[];

  if (format === "csv") {
    const all = (
      await prisma.alert.findMany({
        where,
        orderBy,
        take: EXPORT_ROW_LIMIT,
        include: DETAIL_INCLUDE,
      })
    ).map(present);

    return sendCsv(
      res,
      `alerts-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { header: "Alert", value: (r) => r.number },
        { header: "Priority", value: (r) => r.priority },
        { header: "Status", value: (r) => r.status },
        { header: "Problem", value: (r) => r.description },
        { header: "Equipment", value: (r) => r.equipment.name },
        { header: "Asset no.", value: (r) => r.equipment.assetNo },
        { header: "Department", value: (r) => r.equipment.department.name },
        { header: "Reported", value: (r) => r.openedAt },
        { header: "Reported by", value: (r) => r.raisedBy?.fullName ?? "" },
        { header: "Assigned to", value: (r) => r.assignedTo?.fullName ?? "" },
      ],
      all
    );
  }

  const [total, rows] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.findMany({
      where,
      orderBy,
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

  // The alert, its work order, and every part on it — the whole story
  // in one timeline rather than three places to look.
  const subjects = [
    alert.id,
    ...(alert.workOrder ? [alert.workOrder.id] : []),
    ...(alert.workOrder?.parts.map((part) => part.id) ?? []),
  ];

  const rows = await prisma.auditLog.findMany({
    where: {
      entity: { in: ["Alert", "WorkOrder", "WorkOrderPart"] },
      entityId: { in: subjects },
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
  apply: (alertId: string, from: AlertStatus) => Promise<unknown>
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

  // The status just checked is handed to the caller, which writes with it
  // in the where clause. Between this read and that write another request
  // can move the alert, and two people acknowledging at once would both
  // pass the check above.
  return apply(before.id, before.status);
}

/**
 * Applies a transition only if the alert is still where we left it.
 *
 * Returns null when somebody else got there first, which the caller
 * reports as a conflict rather than silently overwriting their work.
 */
async function guardedUpdate(
  id: string,
  from: AlertStatus,
  data: Parameters<typeof prisma.alert.updateMany>[0]["data"]
) {
  const { count } = await prisma.alert.updateMany({ where: { id, status: from }, data });
  if (count === 0) return null;
  return prisma.alert.findUniqueOrThrow({ where: { id }, include: DETAIL_INCLUDE });
}

const RACED = "That alert was updated by somebody else. Reload it and try again.";

alertsRouter.post("/:id/acknowledge", requireAuth, async (req, res) => {
  await transition(req, res, "acknowledge", async (alertId, from) => {
    const before = await prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
    const alert = await guardedUpdate(alertId, from, {
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
      acknowledgedById: req.user!.id,
    });
    if (!alert) return res.status(409).json({ error: RACED });

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

  await transition(req, res, "assign", async (alertId, from) => {
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
    const alert = await guardedUpdate(alertId, from, {
      status: "ASSIGNED",
      assignedToId: engineer.id,
      assignedAt: new Date(),
    });
    if (!alert) return res.status(409).json({ error: RACED });

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

  await transition(req, res, "cancel", async (alertId, from) => {
    const before = await prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
    const alert = await guardedUpdate(alertId, from, {
      status: "CANCELLED",
      cancelledReason: parsed.data.reason,
      resolvedAt: new Date(),
    });
    if (!alert) return res.status(409).json({ error: RACED });

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
