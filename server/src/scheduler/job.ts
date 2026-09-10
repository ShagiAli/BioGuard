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
import type { Threshold } from "./rules.js";

const QUEUE = "maintenance-sweep";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Everything a digest line needs, and nothing else. */
interface DueDevice {
  device: {
    id: string;
    name: string;
    assetNo: string;
    criticality: string;
    department: { name: string };
    engineer: { email: string } | null;
  };
  threshold: Threshold;
  dueDate: Date;
}

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
export async function runSweep(onDate: Date, collect?: DueDevice[]): Promise<SweepResult> {
  const day = toDay(onDate);

  const candidates = await prisma.equipment.findMany({
    where: {
      operationalStatus: { not: "RETIRED" },
      nextDueAt: { not: null, lte: addDays(day, 30) },
    },
    include: {
      // An engineer who has left is not a recipient. Without this the
      // reminder still goes out, addressed to a person who is gone —
      // which looks exactly like a working schedule and is the quietest
      // way for a device to fall off the programme.
      engineer: {
        where: { isActive: true },
        select: { id: true, email: true, fullName: true },
      },
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
    // threshold.at is days remaining, negative once the date has passed.
    const left =
      threshold.at >= 0
        ? `${threshold.at} day${threshold.at === 1 ? "" : "s"} remaining`
        : `${-threshold.at} day${threshold.at === -1 ? "" : "s"} overdue`;

    const urgent = device.criticality === "CRITICAL" && threshold.at <= 0;
    const title = `${urgent ? "URGENT: " : ""}${device.name} (${device.assetNo}) — maintenance ${threshold.label}`;

    // Enough to decide whether to go now, without opening anything: what
    // it is, where it is, how long is left and how much it matters.
    const body =
      `Preventive maintenance for ${device.name}, asset ${device.assetNo}, ` +
      `in ${device.department.name} is ${threshold.label}.\n\n` +
      `Criticality: ${device.criticality}\n` +
      `Scheduled date: ${iso(dueDate)} (${left})`;

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

  // A range collects and sends once at the end; a single night sends
  // its own. Either way one engineer receives one message.
  const mailable = messages.filter((m) => m.device.engineer);
  if (collect) collect.push(...mailable);
  else await sendDigests(mailable);

  logger.info(
    { date: iso(day), scanned: candidates.length, sent: messages.length },
    "sweep complete"
  );
  return { date: iso(day), scanned: candidates.length, sent: messages.length };
}

/**
 * One message per engineer, listing their devices.
 *
 * It used to be one per device, which is right for the notification
 * feed and wrong for a mailbox. An engineer with five overdue devices
 * received five separate emails to reconcile, and a catch-up sweep
 * sent a dozen near-identical messages in the same second — which
 * reads as noise to a person and as spam to a mail provider. Both
 * happened.
 *
 * Deduplicated by device, keeping the most urgent rung. A multi-day
 * sweep walks each day in turn, so one device sitting near its due
 * date crosses several thresholds in a single press and appeared three
 * times in one email: "due tomorrow", "due today", "overdue by 1 day".
 * Every rung is still recorded and still raises its own notification —
 * this is only about what a person is asked to read.
 *
 * Still deliberately thin: device, where it is, how long is left and a
 * link. No findings, no costs — an inbox is not a system we control.
 */
async function sendDigests(due: DueDevice[]): Promise<void> {
  const byEngineer = new Map<string, DueDevice[]>();
  for (const m of due) {
    if (!m.device.engineer) continue;
    const held = byEngineer.get(m.device.engineer.email) ?? [];
    held.push(m);
    byEngineer.set(m.device.engineer.email, held);
  }

  const digests = [...byEngineer.entries()].map(([to, all]) => {
    // Most urgent rung per device, then most urgent device first.
    const worst = new Map<string, DueDevice>();
    for (const m of all) {
      const seen = worst.get(m.device.id);
      if (!seen || m.threshold.at < seen.threshold.at) worst.set(m.device.id, m);
    }
    const items = [...worst.values()].sort((a, b) => a.threshold.at - b.threshold.at);

    const urgent = items.some((m) => m.device.criticality === "CRITICAL" && m.threshold.at <= 0);
    const prefix = urgent ? "URGENT: " : "";

    /*
     * The most urgent device by name, whatever the count.
     *
     * "2 devices need maintenance" was word for word identical for three
     * of four engineers, and Gmail threads by subject — so four messages
     * collapsed into two conversations and two of them looked as though
     * they had never been sent. Leading with the device makes each
     * subject distinct, and says the useful thing in the line somebody
     * reads before deciding whether to open anything.
     */
    const first = items[0]!;
    const subject =
      items.length === 1
        ? `${prefix}${first.device.name} (${first.device.assetNo}) — maintenance ${first.threshold.label}`
        : `${prefix}${first.device.name} (${first.device.assetNo}) and ${items.length - 1} more need maintenance`;

    const lines = items.map((m) => {
      const left =
        m.threshold.at >= 0
          ? `${m.threshold.at} day${m.threshold.at === 1 ? "" : "s"} remaining`
          : `${-m.threshold.at} day${m.threshold.at === -1 ? "" : "s"} overdue`;
      return (
        `- ${m.device.name} (${m.device.assetNo}), ${m.device.department.name}\n` +
        `  ${m.device.criticality} - ${m.threshold.label}, due ${iso(m.dueDate)} (${left})\n` +
        `  ${env.APP_URL}/equipment/${m.device.id}`
      );
    });

    return {
      to,
      subject,
      text:
        (items.length === 1
          ? `One device assigned to you needs maintenance.\n\n`
          : `${items.length} devices assigned to you need maintenance, most urgent first.\n\n`) +
        lines.join("\n\n"),
    };
  });

  await sendMailMany(digests);
}

/**
 * Advances through a date range one day at a time so no threshold is
 * skipped, and sends once at the end.
 *
 * The nightly run is one day, so its digest is naturally one message. A
 * catch-up covering ninety days is ninety sweeps, and sending per sweep
 * put ninety days of reminders in a mailbox in the same second.
 * Collecting first means somebody who has been away gets one message
 * about their devices rather than one per device per day they missed.
 */
export async function runSweepRange(from: Date, to: Date): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  const collected: DueDevice[] = [];

  let cursor = addDays(from, 1);
  while (cursor.getTime() <= toDay(to).getTime()) {
    results.push(await runSweep(cursor, collected));
    cursor = addDays(cursor, 1);
  }

  await sendDigests(collected);
  return results;
}

/**
 * The nightly run, and the only thing that writes SweepRun.
 *
 * The admin simulation calls runSweep directly and deliberately does
 * not record: it would add a row per simulated day and make a hand-run
 * look like a healthy cron.
 *
 * A failure is written before being rethrown, so the caller still
 * retries and the reason survives. That row is a convenience, not the
 * mechanism — if the process dies outright nothing gets written, which
 * is exactly why staleness rather than error-reporting is what the
 * health check reads.
 *
 * Extracted from the pg-boss worker so the two ways of triggering a
 * sweep cannot drift: the worker below runs this, and on a serverless
 * deployment the platform's scheduler reaches the same function through
 * /api/cron/sweep. A reminder ladder that behaves differently depending
 * on which host you deployed to would be worse than either behaviour.
 */
export async function runScheduledSweep(): Promise<SweepResult> {
  const startedAt = new Date();
  const ranFor = toDay(startedAt);

  try {
    const result = await runSweep(startedAt);
    await prisma.sweepRun.create({
      data: {
        ranFor,
        scanned: result.scanned,
        sent: result.sent,
        startedAt,
        finishedAt: new Date(),
      },
    });
    return result;
  } catch (err) {
    await prisma.sweepRun
      .create({
        data: {
          ranFor,
          scanned: 0,
          sent: 0,
          startedAt,
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch((writeErr: unknown) =>
        logger.error({ writeErr }, "could not record the failed sweep")
      );
    throw err;
  }
}

export async function startScheduler(): Promise<PgBoss> {
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();

  // pg-boss 10 requires queues to exist before work or schedules can
  // reference them. Idempotent, so it is safe on every boot.
  await boss.createQueue(QUEUE);

  await boss.work(QUEUE, runScheduledSweep);

  // 02:00 daily. pg-boss deduplicates the schedule across instances, so
  // running several API replicas does not mean several sweeps.
  await boss.schedule(QUEUE, "0 2 * * *", undefined, { tz: env.TIMEZONE });

  logger.info("scheduler started");
  return boss;
}
