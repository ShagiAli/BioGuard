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
  canMoveWorkOrder,
  canTransitionAlert,
  deviceStatusFor,
  maintenanceTypeFor,
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
