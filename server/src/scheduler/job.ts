/**
 * The nightly maintenance sweep.
 *
 * runSweep() is deliberately separate from the pg-boss wiring so it can
 * be called with any date: once per night in production, or repeatedly
 * with future dates to demonstrate the reminder ladder without waiting
 * a month.
 */

import PgBoss from "pg-boss";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { sendMailMany } from "../lib/email.js";
import { env } from "../env.js";
import { addDays, thresholdFor, toDay } from "./rules.js";

const QUEUE = "maintenance-sweep";

export interface SweepResult {
  date: string;
  scanned: number;
  sent: number;
}

/**
 * One day of the scheduler.
 *
 * The candidate query is bounded: only devices whose due date sits
 * within the reminder ladder can possibly fire, so this stays an
 * indexed range scan rather than a walk of the whole estate.
 */
export async function runSweep(onDate: Date): Promise<SweepResult> {
  const day = toDay(onDate);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const candidates = await prisma.equipment.findMany({
    where: {
      operationalStatus: { not: "RETIRED" },
      nextDueAt: { not: null, lte: addDays(day, 30) },
    },
    include: {
      engineer: { select: { id: true, email: true, fullName: true } },
      department: { select: { name: true } },
    },
  });

  // Which devices earn a reminder today.
  const due = candidates.flatMap((device) => {
    const threshold = thresholdFor(device.nextDueAt, day);
    return threshold && device.nextDueAt ? [{ device, threshold, dueDate: device.nextDueAt }] : [];
  });

  if (due.length === 0) {
    logger.info({ date: iso(day), scanned: candidates.length, sent: 0 }, "sweep complete");
    return { date: iso(day), scanned: candidates.length, sent: 0 };
  }

  /**
   * Which of those have already been sent.
   *
   * One query for the whole day rather than an insert-and-catch per
   * device. The unique constraint on NotificationDispatch remains the
   * guarantee — this is the fast path, not the correctness mechanism,
   * and skipDuplicates below still refuses anything that slips through
   * between the read and the write.
   */
  const already = await prisma.notificationDispatch.findMany({
    where: {
      equipmentId: { in: due.map((d) => d.device.id) },
      dueDate: { in: [...new Set(due.map((d) => d.dueDate.getTime()))].map((t) => new Date(t)) },
    },
    select: { equipmentId: true, dueDate: true, threshold: true },
  });

  const sentKey = (equipmentId: string, dueDate: Date, threshold: number) =>
    `${equipmentId}|${iso(dueDate)}|${threshold}`;

  const seen = new Set(already.map((a) => sentKey(a.equipmentId, a.dueDate, a.threshold)));
  const fresh = due.filter((d) => !seen.has(sentKey(d.device.id, d.dueDate, d.threshold.at)));

  if (fresh.length === 0) {
    logger.info({ date: iso(day), scanned: candidates.length, sent: 0 }, "sweep complete");
    return { date: iso(day), scanned: candidates.length, sent: 0 };
  }

  const messages = fresh.map(({ device, threshold, dueDate }) => {
    const title = `${device.name} (${device.assetNo}) — maintenance ${threshold.label}`;
    const body =
      `Preventive maintenance for ${device.name}, asset ${device.assetNo}, ` +
      `in ${device.department.name} is ${threshold.label}. ` +
      `Scheduled date: ${iso(dueDate)}.`;
    return { device, threshold, dueDate, title, body };
  });

  // Three writes for the whole day, whatever the device count.
  await prisma.$transaction([
    prisma.notificationDispatch.createMany({
      data: messages.map((m) => ({
        equipmentId: m.device.id,
        dueDate: m.dueDate,
        threshold: m.threshold.at,
      })),
      skipDuplicates: true,
    }),
    prisma.notification.createMany({
      data: messages
        .filter((m) => m.device.engineer)
        .map((m) => ({
          recipientId: m.device.engineer!.id,
          equipmentId: m.device.id,
          level: m.threshold.level,
          title: m.title,
          body: m.body,
        })),
    }),
  ]);

  // Deliberately thin: device, date and a link. No findings, no costs —
  // an inbox is not a system we control.
  await sendMailMany(
    messages
      .filter((m) => m.device.engineer)
      .map((m) => ({
        to: m.device.engineer!.email,
        subject: m.title,
        text: `${m.body}\n\nOpen in BioGuard: ${env.APP_URL}/equipment/${m.device.id}`,
      }))
  );

  logger.info(
    { date: iso(day), scanned: candidates.length, sent: messages.length },
    "sweep complete"
  );
  return { date: iso(day), scanned: candidates.length, sent: messages.length };
}

/** Advances through a date range one day at a time so no threshold is skipped. */
export async function runSweepRange(from: Date, to: Date): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  let cursor = addDays(from, 1);
  while (cursor.getTime() <= toDay(to).getTime()) {
    results.push(await runSweep(cursor));
    cursor = addDays(cursor, 1);
  }
  return results;
}

export async function startScheduler(): Promise<PgBoss> {
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();

  // pg-boss 10 requires queues to exist before work or schedules can
  // reference them. Idempotent, so it is safe on every boot.
  await boss.createQueue(QUEUE);

  await boss.work(QUEUE, async () => {
    await runSweep(new Date());
  });

  // 02:00 daily. pg-boss deduplicates the schedule across instances, so
  // running several API replicas does not mean several sweeps.
  await boss.schedule(QUEUE, "0 2 * * *", undefined, { tz: env.TIMEZONE });

  logger.info("scheduler started");
  return boss;
}
