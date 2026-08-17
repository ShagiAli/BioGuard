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
import { sendMail } from "../lib/email.js";
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

  let sent = 0;

  for (const device of candidates) {
    const threshold = thresholdFor(device.nextDueAt, day);
    if (!threshold || !device.nextDueAt) continue;

    // The idempotency guarantee. The unique constraint on
    // (equipmentId, dueDate, threshold) is what actually enforces
    // "once". skipDuplicates lets the database refuse the insert
    // without raising, so a day already swept is an ordinary no-op
    // rather than a caught exception — and a concurrent worker losing
    // the race behaves the same way.
    const inserted = await prisma.notificationDispatch.createMany({
      data: [{ equipmentId: device.id, dueDate: device.nextDueAt, threshold: threshold.at }],
      skipDuplicates: true,
    });

    if (inserted.count === 0) continue; // already sent for this due date and rung

    const title = `${device.name} (${device.assetNo}) — maintenance ${threshold.label}`;
    const body =
      `Preventive maintenance for ${device.name}, asset ${device.assetNo}, ` +
      `in ${device.department.name} is ${threshold.label}. ` +
      `Scheduled date: ${device.nextDueAt.toISOString().slice(0, 10)}.`;

    if (device.engineer) {
      await prisma.notification.create({
        data: {
          recipientId: device.engineer.id,
          equipmentId: device.id,
          level: threshold.level,
          title,
          body,
        },
      });

      // Deliberately thin: device, date, and a link. No findings, no
      // costs — an inbox is not a system we control.
      await sendMail({
        to: device.engineer.email,
        subject: title,
        text: `${body}\n\nOpen in BioGuard: ${env.APP_URL}/equipment/${device.id}`,
      });
    }

    sent++;
  }

  logger.info(
    { date: day.toISOString().slice(0, 10), scanned: candidates.length, sent },
    "sweep complete"
  );
  return { date: day.toISOString().slice(0, 10), scanned: candidates.length, sent };
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
