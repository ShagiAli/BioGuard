import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { runSweepRange } from "../../scheduler/job.js";
import { addDays, toDay } from "../../scheduler/rules.js";
import { SWEEP_STALE_AFTER_HOURS, schedulerState, sweepFreshness } from "../../scheduler/status.js";

export const adminRouter = Router();

const simulateSchema = z.object({ days: z.coerce.number().int().min(1).max(365) }).strict();

/**
 * Runs the nightly sweep forward over a range of future dates.
 *
 * A maintenance reminder system is almost impossible to demonstrate
 * honestly: its whole job happens once a month, at 02:00. Rather than
 * fake the output, this replays the real scheduler day by day against
 * real data, so what appears in the inbox is what would have been sent.
 *
 * Safe to repeat: the unique constraint on NotificationDispatch means a
 * day already swept produces nothing the second time.
 */
adminRouter.post("/simulate", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose between 1 and 365 days." });

  const from = toDay(new Date());
  const results = await runSweepRange(from, addDays(from, parsed.data.days));
  const sent = results.reduce((total, r) => total + r.sent, 0);

  res.json({
    daysAdvanced: parsed.data.days,
    through: addDays(from, parsed.data.days).toISOString().slice(0, 10),
    notificationsSent: sent,
    days: results.filter((r) => r.sent > 0),
  });
});

/**
 * Clears dispatch history so the same date range can be demonstrated
 * again. Deliberately admin-only and deliberately explicit: this is the
 * one operation that makes duplicate reminders possible.
 */
adminRouter.post("/reset-dispatches", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const { count } = await prisma.notificationDispatch.deleteMany({});
  await prisma.notification.deleteMany({});
  res.json({ cleared: count });
});

/**
 * Whether the reminder engine is actually running.
 *
 * The failure this answers for is specific: the scheduler dies, the API
 * carries on serving, and reminders stop without anyone noticing.
 * `/api/health` reports only a boolean because it is unauthenticated —
 * the timestamps and the failure reason are here, behind a role.
 *
 * Managers see it as well as administrators. They own the maintenance
 * programme, so they are the people who need to know the reminders have
 * stopped, even though they cannot restart anything themselves.
 */
adminRouter.get("/scheduler", requireAuth, requireRole("ADMIN", "MANAGER"), async (_req, res) => {
  const { running, startedAt, lastError, mode } = schedulerState();

  const [lastSweep, recent] = await Promise.all([
    prisma.sweepRun.findFirst({
      where: { trigger: "SCHEDULED", error: null },
      orderBy: { startedAt: "desc" },
    }),
    prisma.sweepRun.findMany({
      where: { trigger: "SCHEDULED" },
      orderBy: { startedAt: "desc" },
      take: 14,
    }),
  ]);

  const freshness = sweepFreshness(lastSweep?.startedAt ?? null, startedAt);

  res.json({
    running,
    // Which shape this deployment is: a worker holding the schedule, or
    // a platform cron calling in. It stays behind the role check with
    // the rest of the detail — on a cron deployment it tells the reader
    // that /api/cron/sweep exists, which is not something the
    // unauthenticated health endpoint should be volunteering.
    mode,
    startedAt,
    lastError,
    freshness,
    staleAfterHours: SWEEP_STALE_AFTER_HOURS,
    lastSweepAt: lastSweep?.startedAt ?? null,
    lastSweepFor: lastSweep?.ranFor ?? null,
    recent,
  });
});
