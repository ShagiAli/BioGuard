import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { runSweepRange } from "../../scheduler/job.js";
import { addDays, toDay } from "../../scheduler/rules.js";

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
