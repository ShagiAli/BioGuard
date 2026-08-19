/**
 * Preventive maintenance scheduling rules.
 *
 * Everything here is pure and takes the reference date as an argument.
 * The nightly job passes today; tests pass arbitrary dates; the demo
 * "time travel" control passes a future date. One code path, no
 * test-only branches, and no hidden dependency on the system clock.
 *
 * All dates are handled as UTC calendar days. A device due "today" in
 * Mersin must not read as due yesterday because the server is on UTC.
 */

export type ScheduleMode = "GRACE" | "ANCHORED";

const DAY_MS = 86_400_000;
const GRACE_RATIO = 0.2;

/** Strips any time component, pinning a Date to a UTC calendar day. */
export function toDay(value: Date | string): Date {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(value: Date | string, days: number): Date {
  return new Date(toDay(value).getTime() + days * DAY_MS);
}

/** Whole days from `a` until `b`. Negative when `b` is already past. */
export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.round((toDay(b).getTime() - toDay(a).getTime()) / DAY_MS);
}

export function graceDays(intervalDays: number, override?: number | null): number {
  return override ?? Math.round(intervalDays * GRACE_RATIO);
}

export interface RecalculateInput {
  scheduleMode: ScheduleMode;
  previousDue: Date | null;
  completedOn: Date;
  intervalDays: number;
  graceDaysOverride?: number | null;
}

export interface RecalculateResult {
  nextDue: Date;
  /** True when the anchor moved onto the completion date. */
  rebased: boolean;
  /** Positive when the work was late, negative when early. */
  latenessDays: number | null;
  graceWindow: number;
}

/**
 * Works out the next due date once maintenance is filed.
 *
 * ANCHORED — next due is always previous due + interval, regardless of
 *   when the work happened. For anything governed by an external
 *   certificate or a fixed annual test.
 *
 * GRACE — keeps the original anchor when the work landed inside the
 *   grace window, so ordinary small delays do not drift the schedule.
 *   Beyond the window the anchor re-bases onto the completion date and
 *   `rebased` is recorded, because a re-base is a signal that the
 *   programme is slipping and must be visible in reporting rather than
 *   quietly absorbed.
 */
export function recalculateDue(input: RecalculateInput): RecalculateResult {
  const { scheduleMode, previousDue, completedOn, intervalDays } = input;
  const window = graceDays(intervalDays, input.graceDaysOverride);
  const completed = toDay(completedOn);

  // First ever service, or a device that was never scheduled.
  if (!previousDue) {
    return { nextDue: addDays(completed, intervalDays), rebased: false, latenessDays: null, graceWindow: window };
  }

  const due = toDay(previousDue);
  const latenessDays = daysBetween(due, completed);

  if (scheduleMode === "ANCHORED" || latenessDays <= window) {
    return { nextDue: addDays(due, intervalDays), rebased: false, latenessDays, graceWindow: window };
  }
  return { nextDue: addDays(completed, intervalDays), rebased: true, latenessDays, graceWindow: window };
}

// ------------------------------------------------------------ reminders

export type ThresholdLevel = "INFO" | "WARNING" | "URGENT" | "DUE" | "OVERDUE";

export interface Threshold {
  /** Days remaining. Negative values mean overdue. */
  at: number;
  level: ThresholdLevel;
  label: string;
}

export const THRESHOLDS: Threshold[] = [
  { at: 30, level: "INFO", label: "due in 30 days" },
  { at: 14, level: "WARNING", label: "due in 14 days" },
  { at: 7, level: "URGENT", label: "due in 7 days" },
  { at: 1, level: "URGENT", label: "due tomorrow" },
  { at: 0, level: "DUE", label: "due today" },
];

/**
 * Which reminder, if any, a device earns on a given date. Returns null
 * on every other day. Overdue devices escalate on the first day late
 * and weekly after that, so an ignored device keeps surfacing without
 * mailing someone daily.
 */
export function thresholdFor(nextDue: Date | null, onDate: Date): Threshold | null {
  if (!nextDue) return null;
  const remaining = daysBetween(onDate, nextDue);

  if (remaining >= 0) {
    return THRESHOLDS.find((t) => t.at === remaining) ?? null;
  }

  const overdueBy = -remaining;
  if (overdueBy === 1 || overdueBy % 7 === 0) {
    return {
      at: remaining,
      level: "OVERDUE",
      label: `overdue by ${overdueBy} day${overdueBy === 1 ? "" : "s"}`,
    };
  }
  return null;
}

export type PmState = "OVERDUE" | "DUE_NOW" | "DUE_SOON" | "SCHEDULED" | "UNSCHEDULED";

/** Derived, never stored. The single definition the whole app uses. */
export function pmState(nextDue: Date | null, onDate: Date): PmState {
  if (!nextDue) return "UNSCHEDULED";
  const remaining = daysBetween(onDate, nextDue);
  if (remaining < 0) return "OVERDUE";
  if (remaining <= 7) return "DUE_NOW";
  if (remaining <= 30) return "DUE_SOON";
  return "SCHEDULED";
}
