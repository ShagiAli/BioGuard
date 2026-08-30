import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { equipmentScope, requireAuth, requireRole } from "../../middleware/auth.js";
import { recalculateDue, toDay } from "../../scheduler/rules.js";

export const maintenanceRouter = Router();

const createSchema = z
  .object({
    equipmentId: z.string().uuid(),
    type: z.enum([
      "PREVENTIVE",
      "CORRECTIVE",
      "EMERGENCY",
      "CALIBRATION",
      "INSPECTION",
      "SAFETY_TEST",
    ]),
    completedOn: z.coerce.date(),
    problem: z.string().max(2000).optional(),
    findings: z.string().max(2000).optional(),
    workPerformed: z.string().min(1, "Describe the work performed.").max(4000),
    cost: z.coerce.number().min(0).max(10_000_000).optional(),
    downtimeHours: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

/**
 * Files a maintenance record and moves the schedule.
 *
 * Three things happen together or not at all: the record is written,
 * the device's anchor moves, and any pending reminders for the due date
 * just satisfied are cleared. A partial result here would either lose
 * the work or keep nagging the engineer who did it.
 *
 * Only PREVENTIVE work resets the clock. Repairing a broken sensor is
 * not the scheduled service and must not buy the device another cycle.
 */
maintenanceRouter.post("/", requireAuth, requireRole("ADMIN", "ENGINEER"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Check the form.",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  const input = parsed.data;
  const completedOn = toDay(input.completedOn);

  if (completedOn.getTime() > toDay(new Date()).getTime()) {
    return res.status(400).json({ error: "Maintenance cannot be recorded for a future date." });
  }

  const device = await prisma.equipment.findFirst({
    where: { id: input.equipmentId, ...equipmentScope(req.user!) },
  });
  if (!device) return res.status(404).json({ error: "Equipment not found." });

  const resetsSchedule = input.type === "PREVENTIVE";
  const satisfiedDueDate = device.nextDueAt;

  const schedule = resetsSchedule
    ? recalculateDue({
        scheduleMode: device.scheduleMode,
        previousDue: device.nextDueAt,
        completedOn,
        intervalDays: device.intervalDays,
        graceDaysOverride: device.graceDaysOverride,
      })
    : null;

  const [record, updated] = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenanceRecord.create({
      data: {
        equipmentId: device.id,
        type: input.type,
        completedOn,
        engineerId: req.user!.id,
        problem: input.problem ?? null,
        findings: input.findings ?? null,
        workPerformed: input.workPerformed,
        cost: input.cost ?? null,
        downtimeHours: input.downtimeHours,
        satisfiedDueDate: resetsSchedule ? satisfiedDueDate : null,
        latenessDays: schedule?.latenessDays ?? null,
        rebased: schedule?.rebased ?? false,
        nextDueAfter: schedule?.nextDue ?? null,
      },
    });

    const device2 = await tx.equipment.update({
      where: { id: device.id },
      data: resetsSchedule
        ? {
            lastCompletedAt: completedOn,
            nextDueAt: schedule!.nextDue,
            operationalStatus: "OPERATIONAL",
          }
        : {},
    });

    // The reminders for the due date just satisfied no longer apply.
    if (resetsSchedule && satisfiedDueDate) {
      await tx.notificationDispatch.deleteMany({
        where: { equipmentId: device.id, dueDate: satisfiedDueDate },
      });
    }

    return [created, device2] as const;
  });

  await recordAudit({
    actorId: req.user!.id,
    action: schedule?.rebased ? "maintenance.recorded_rebased" : "maintenance.recorded",
    entity: "Equipment",
    entityId: device.id,
    before: device,
    after: updated,
  });

  res.status(201).json({
    record,
    nextDueAt: updated.nextDueAt,
    // Surfaced so the UI can explain what happened to the schedule
    // rather than silently showing a new date.
    schedule: schedule
      ? {
          rebased: schedule.rebased,
          latenessDays: schedule.latenessDays,
          graceWindow: schedule.graceWindow,
        }
      : null,
  });
});
