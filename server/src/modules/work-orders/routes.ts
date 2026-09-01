/**
 * Work orders: the engineering response to an alert.
 *
 * Three things make this more than a second status column:
 *
 *  - its status drives the device's operationalStatus, so the equipment
 *    list tells the truth without anyone remembering to update it;
 *  - closing one writes a MaintenanceRecord, so a repair lands in the
 *    device's history beside its scheduled services — and because only
 *    PREVENTIVE work resets the schedule, it does not buy the device
 *    another maintenance cycle;
 *  - once closed it is read-only to everyone but an administrator, which
 *    is what makes the archive worth reporting from.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { alertScope, requireAuth, requireRole } from "../../middleware/auth.js";
import {
  canEditWorkOrder,
  canMovePart,
  canMoveWorkOrder,
  canTransitionAlert,
  deviceStatusFor,
  maintenanceTypeFor,
  PART_TIMESTAMP,
  partsSettled,
  workOrderNumber,
} from "../alerts/workflow.js";
import { notifyResolved } from "../alerts/notify.js";

export const workOrdersRouter = Router();

const DETAIL_INCLUDE = {
  alert: {
    select: {
      id: true,
      seq: true,
      openedAt: true,
      description: true,
      priority: true,
      status: true,
      raisedBy: { select: { id: true, fullName: true } },
    },
  },
  equipment: {
    select: { id: true, name: true, assetNo: true, operationalStatus: true },
  },
  engineer: { select: { id: true, fullName: true } },
  closedBy: { select: { id: true, fullName: true } },
  // Oldest first, so the list reads as the order the engineer decided
  // each part was needed.
  parts: { orderBy: { createdAt: "asc" } },
} as const;

function present<T extends { seq: number; createdAt: Date }>(wo: T) {
  return { ...wo, number: workOrderNumber(wo.seq, wo.createdAt) };
}

/**
 * Work orders are reachable exactly when their alert is.
 *
 * Deriving visibility from the alert rather than restating it means the
 * two can never disagree — there is one scoping rule, not two.
 */
function scoped(user: Parameters<typeof alertScope>[0]) {
  return { alert: alertScope(user) };
}

// ------------------------------------------------------------- create

const createSchema = z
  .object({
    alertId: z.uuid(),
    findings: z.string().max(4000).optional(),
    diagnosis: z.string().max(2000).optional(),
  })
  .strict();

/**
 * Open a work order against an assigned alert.
 *
 * This is also what moves the alert to IN_PROGRESS: the engineer starting
 * work is the event, and making it a separate button to remember would
 * guarantee the two drift apart.
 */
workOrdersRouter.post("/", requireAuth, requireRole("ENGINEER", "ADMIN"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the form." });

  const alert = await prisma.alert.findFirst({
    where: { id: parsed.data.alertId, ...alertScope(req.user!) },
    include: { workOrder: { select: { id: true } } },
  });
  if (!alert) return res.status(404).json({ error: "Alert not found." });

  if (alert.workOrder) {
    return res.status(409).json({ error: "This alert already has a work order." });
  }

  // An engineer may only start work assigned to them; an administrator
  // may start anything.
  if (req.user!.role === "ENGINEER" && alert.assignedToId !== req.user!.id) {
    return res.status(403).json({ error: "This alert is assigned to another engineer." });
  }

  const check = canTransitionAlert("start", alert.status, req.user!.role);
  if (!check.ok) {
    return res.status(check.reason?.includes("role") ? 403 : 409).json({ error: check.reason });
  }

  const created = await prisma.$transaction(async (tx) => {
    // The alert moves first. DETAIL_INCLUDE reads the alert back as part
    // of the work order, so creating the work order first would return a
    // response still claiming the alert is merely ASSIGNED.
    await tx.alert.update({ where: { id: alert.id }, data: { status: "IN_PROGRESS" } });

    const wo = await tx.workOrder.create({
      data: {
        alertId: alert.id,
        equipmentId: alert.equipmentId,
        engineerId: alert.assignedToId ?? req.user!.id,
        priority: alert.priority,
        findings: parsed.data.findings ?? null,
        diagnosis: parsed.data.diagnosis ?? null,
      },
      include: DETAIL_INCLUDE,
    });

    const deviceStatus = deviceStatusFor(wo.status);
    if (deviceStatus) {
      await tx.equipment.update({
        where: { id: alert.equipmentId },
        data: { operationalStatus: deviceStatus },
      });
    }

    return wo;
  });

  await recordAudit({
    actorId: req.user!.id,
    action: "workorder.opened",
    entity: "WorkOrder",
    entityId: created.id,
    after: created,
  });

  res.status(201).json(present(created));
});

// --------------------------------------------------------------- read

const listQuery = z
  .object({
    status: z
      .enum(["INVESTIGATING", "AWAITING_PARTS", "IN_REPAIR", "COMPLETED", "CLOSED", "CANCELLED"])
      .optional(),
    archived: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

workOrdersRouter.get("/", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Unrecognised filter." });

  const { status, archived, page, pageSize } = parsed.data;

  // The archive is a view of this list, not a separate table: closed work
  // orders stay queryable beside live ones for reporting.
  const where = {
    ...scoped(req.user!),
    ...(status ? { status } : {}),
    ...(archived === "true" ? { status: "CLOSED" as const } : {}),
    ...(archived === "false" ? { status: { not: "CLOSED" as const } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: DETAIL_INCLUDE,
    }),
  ]);

  res.json({ total, page, pageSize, rows: rows.map(present) });
});

/**
 * Counts for the dashboard.
 *
 * Declared before /:id so "summary" is never read as an identifier, and
 * scoped exactly like the list below — a figure and the list behind it
 * are produced by the same predicate, so they cannot disagree.
 */
workOrdersRouter.get("/summary", requireAuth, async (req, res) => {
  const scope = scoped(req.user!);

  const [inProgress, awaitingParts, partsOrdered, closed] = await Promise.all([
    prisma.workOrder.count({
      where: { ...scope, status: { notIn: ["CLOSED", "CANCELLED"] } },
    }),
    prisma.workOrder.count({ where: { ...scope, status: "AWAITING_PARTS" } }),
    // Parts actually on order, rather than work orders that mention parts:
    // "three parts ordered" is the number a manager is chasing.
    prisma.workOrderPart.count({
      where: { status: "ORDERED", workOrder: scope },
    }),
    prisma.workOrder.count({ where: { ...scope, status: "CLOSED" } }),
  ]);

  res.json({ inProgress, awaitingParts, partsOrdered, closed });
});

workOrdersRouter.get("/:id", requireAuth, async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Work order not found." });

  const wo = await prisma.workOrder.findFirst({
    where: { id: id.data, ...scoped(req.user!) },
    include: DETAIL_INCLUDE,
  });
  if (!wo) return res.status(404).json({ error: "Work order not found." });

  res.json(present(wo));
});

// ------------------------------------------------------------- update

const updateSchema = z
  .object({
    status: z
      .enum(["INVESTIGATING", "AWAITING_PARTS", "IN_REPAIR", "COMPLETED", "CANCELLED"])
      .optional(),
    findings: z.string().max(4000).nullable().optional(),
    diagnosis: z.string().max(2000).nullable().optional(),
    repairActions: z.string().max(4000).nullable().optional(),
  })
  .strict();

workOrdersRouter.patch("/:id", requireAuth, requireRole("ENGINEER", "ADMIN"), async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Work order not found." });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Unrecognised field." });

  const before = await prisma.workOrder.findFirst({
    where: { id: id.data, ...scoped(req.user!) },
    include: DETAIL_INCLUDE,
  });
  if (!before) return res.status(404).json({ error: "Work order not found." });

  const editable = canEditWorkOrder(before.status, req.user!.role);
  if (!editable.ok) return res.status(403).json({ error: editable.reason });

  if (parsed.data.status) {
    const move = canMoveWorkOrder(before.status, parsed.data.status);
    if (!move.ok) return res.status(409).json({ error: move.reason });
  }

  const nextStatus = parsed.data.status ?? before.status;

  const updated = await prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.update({
      where: { id: before.id },
      data: {
        ...parsed.data,
        completedAt: parsed.data.status === "COMPLETED" ? new Date() : before.completedAt,
      },
      include: DETAIL_INCLUDE,
    });

    const deviceStatus = deviceStatusFor(nextStatus);
    if (deviceStatus && deviceStatus !== before.equipment.operationalStatus) {
      await tx.equipment.update({
        where: { id: wo.equipmentId },
        data: { operationalStatus: deviceStatus },
      });
    }

    return wo;
  });

  await recordAudit({
    actorId: req.user!.id,
    action: before.status === "CLOSED" ? "workorder.edited_after_close" : "workorder.updated",
    entity: "WorkOrder",
    entityId: updated.id,
    before,
    after: updated,
  });

  res.json(present(updated));
});

// -------------------------------------------------------------- close

const closeSchema = z
  .object({
    repairActions: z.string().min(1, "Describe the repair.").max(4000),
    finalResolution: z.string().min(1, "Record the outcome.").max(2000),
    cost: z.coerce.number().min(0).max(10_000_000).optional(),
    downtimeHours: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

/**
 * Close the work order and return the device to service.
 *
 * One transaction covers the work order, the alert, the device status and
 * the maintenance record. A partial result here would leave a device
 * marked under repair with nobody working on it, or a repair with no
 * trace in the device's history.
 */
workOrdersRouter.post(
  "/:id/close",
  requireAuth,
  requireRole("ENGINEER", "ADMIN"),
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: "Work order not found." });

    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Check the form.",
        issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const before = await prisma.workOrder.findFirst({
      where: { id: id.data, ...scoped(req.user!) },
      include: DETAIL_INCLUDE,
    });
    if (!before) return res.status(404).json({ error: "Work order not found." });

    if (before.status === "CLOSED") {
      return res.status(409).json({ error: "This work order is already closed." });
    }

    const move = canMoveWorkOrder(
      before.status === "COMPLETED" ? "COMPLETED" : before.status,
      "CLOSED"
    );
    if (!move.ok) {
      return res.status(409).json({
        error: "Mark the work order completed before closing it.",
      });
    }

    // A device must not go back to the ward while a part is still on
    // order. This is the check the whole parts ladder exists to enable.
    const parts = partsSettled(before.parts.map((part) => part.status));
    if (!parts.ok) return res.status(409).json({ error: parts.reason });

    const closedAt = new Date();

    const closed = await prisma.$transaction(async (tx) => {
      // The repair joins the device's service history. Type CORRECTIVE (or
      // EMERGENCY) rather than PREVENTIVE, so the maintenance schedule is
      // deliberately left untouched.
      const record = await tx.maintenanceRecord.create({
        data: {
          equipmentId: before.equipmentId,
          type: maintenanceTypeFor(before.priority),
          completedOn: closedAt,
          engineerId: req.user!.id,
          problem: before.alert.description,
          findings: before.findings,
          workPerformed: parsed.data.repairActions,
          cost: parsed.data.cost ?? null,
          downtimeHours: parsed.data.downtimeHours,
        },
      });

      const wo = await tx.workOrder.update({
        where: { id: before.id },
        data: {
          status: "CLOSED",
          repairActions: parsed.data.repairActions,
          finalResolution: parsed.data.finalResolution,
          completedAt: before.completedAt ?? closedAt,
          closedAt,
          closedById: req.user!.id,
          maintenanceRecordId: record.id,
        },
        include: DETAIL_INCLUDE,
      });

      await tx.alert.update({
        where: { id: before.alertId },
        data: { status: "RESOLVED", resolvedAt: closedAt },
      });

      const deviceStatus = deviceStatusFor("CLOSED");
      if (deviceStatus) {
        await tx.equipment.update({
          where: { id: before.equipmentId },
          data: { operationalStatus: deviceStatus },
        });
      }

      return wo;
    });

    await recordAudit({
      actorId: req.user!.id,
      action: "workorder.closed",
      entity: "WorkOrder",
      entityId: closed.id,
      before,
      after: closed,
    });

    const alert = await prisma.alert.findUniqueOrThrow({
      where: { id: before.alertId },
      include: { equipment: { select: { name: true, assetNo: true } } },
    });
    await notifyResolved(alert, parsed.data.finalResolution);

    res.json(present(closed));
  }
);

// -------------------------------------------------------------- parts

/**
 * Loads a work order the caller may change, or answers for itself.
 *
 * Every parts route needs the same three questions settled: is it
 * visible, does it belong to this engineer, is it still open. Asking them
 * once here keeps the four handlers below to their actual subject.
 */
async function editableWorkOrder(
  req: Parameters<typeof requireAuth>[0],
  res: Parameters<typeof requireAuth>[1],
  id: string
) {
  const wo = await prisma.workOrder.findFirst({
    where: { id, ...scoped(req.user!) },
    include: DETAIL_INCLUDE,
  });
  if (!wo) {
    res.status(404).json({ error: "Work order not found." });
    return null;
  }

  const editable = canEditWorkOrder(wo.status, req.user!.role);
  if (!editable.ok) {
    res.status(403).json({ error: editable.reason });
    return null;
  }

  if (req.user!.role === "ENGINEER" && wo.engineerId !== req.user!.id) {
    res.status(403).json({ error: "This work order belongs to another engineer." });
    return null;
  }

  return wo;
}

const addPartSchema = z
  .object({
    name: z.string().min(1, "Name the part.").max(200),
    partNumber: z.string().max(100).optional(),
    quantity: z.coerce.number().int().min(1).max(999).default(1),
    notes: z.string().max(1000).optional(),
  })
  .strict();

workOrdersRouter.post(
  "/:id/parts",
  requireAuth,
  requireRole("ENGINEER", "ADMIN"),
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: "Work order not found." });

    const parsed = addPartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Check the part details.",
        issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const wo = await editableWorkOrder(req, res, id.data);
    if (!wo) return;

    const part = await prisma.workOrderPart.create({
      data: {
        workOrderId: wo.id,
        name: parsed.data.name,
        partNumber: parsed.data.partNumber ?? null,
        quantity: parsed.data.quantity,
        notes: parsed.data.notes ?? null,
      },
    });

    // Audited as itself. Writing this against the work order meant
    // smuggling a sentence into its `findings`, which then read back
    // as though an engineer had edited their notes. Misleading
    // history is worse than none.
    await recordAudit({
      actorId: req.user!.id,
      action: "workorderpart.added",
      entity: "WorkOrderPart",
      entityId: part.id,
      after: part,
    });

    res.status(201).json(part);
  }
);

const updatePartSchema = z
  .object({
    status: z
      .enum(["REQUIRED", "REQUESTED", "ORDERED", "RECEIVED", "INSTALLED", "CANCELLED"])
      .optional(),
    quantity: z.coerce.number().int().min(1).max(999).optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();

workOrdersRouter.patch(
  "/:id/parts/:partId",
  requireAuth,
  requireRole("ENGINEER", "ADMIN"),
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const partId = z.uuid().safeParse(req.params.partId);
    if (!id.success || !partId.success) return res.status(404).json({ error: "Part not found." });

    const parsed = updatePartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Unrecognised field." });

    const wo = await editableWorkOrder(req, res, id.data);
    if (!wo) return;

    const part = wo.parts.find((row) => row.id === partId.data);
    if (!part) return res.status(404).json({ error: "Part not found." });

    const { status, ...rest } = parsed.data;
    let stamped: Record<string, Date> = {};

    if (status && status !== part.status) {
      const move = canMovePart(part.status, status);
      if (!move.ok) return res.status(409).json({ error: move.reason });

      // Each rung records when it was reached, so a stalled order can be
      // read straight off the row instead of reconstructed from the log.
      const field = PART_TIMESTAMP[status];
      if (field) stamped = { [field]: new Date() };
    }

    const updated = await prisma.workOrderPart.update({
      where: { id: part.id },
      data: { ...rest, ...(status ? { status } : {}), ...stamped },
    });

    if (status && status !== part.status) {
      await recordAudit({
        actorId: req.user!.id,
        action: "workorderpart." + status.toLowerCase(),
        entity: "WorkOrderPart",
        entityId: part.id,
        before: part,
        after: updated,
      });
    }

    res.json(updated);
  }
);

/**
 * Remove a part line.
 *
 * Only before anything has been requested. After that the line belongs to
 * the record: cancelling it says what happened, deleting it pretends it
 * never did.
 */
workOrdersRouter.delete(
  "/:id/parts/:partId",
  requireAuth,
  requireRole("ENGINEER", "ADMIN"),
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const partId = z.uuid().safeParse(req.params.partId);
    if (!id.success || !partId.success) return res.status(404).json({ error: "Part not found." });

    const wo = await editableWorkOrder(req, res, id.data);
    if (!wo) return;

    const part = wo.parts.find((row) => row.id === partId.data);
    if (!part) return res.status(404).json({ error: "Part not found." });

    if (part.status !== "REQUIRED") {
      return res.status(409).json({
        error: "This part has already been requested. Cancel it instead, so the record stands.",
      });
    }

    await prisma.workOrderPart.delete({ where: { id: part.id } });
    res.status(204).end();
  }
);
