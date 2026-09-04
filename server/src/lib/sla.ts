/**
 * How quickly a reported fault has to be picked up.
 *
 * This is policy, not data. It lives here as a constant for the same
 * reason the maintenance grace window does: one hospital-wide rule that
 * every alert is measured against, rather than a per-alert column that
 * could be edited into agreeing with whatever actually happened.
 *
 * Nothing here is stored. The target is derived from when the fault was
 * reported, and whether it was met is derived from when somebody
 * acknowledged it — both of which the alert already records. A schema
 * change would add a column whose only job is to restate a subtraction.
 */
import type { Priority } from "@prisma/client";

/**
 * Minutes from report to acknowledgement.
 *
 * An emergency is a device that has stopped in a clinical area, so the
 * window is short enough that somebody has to be looking. The lower
 * bands are working-day answers rather than clock answers, which is
 * what a biomedical department can actually staff.
 */
export const SLA_RESPONSE_MINUTES: Record<Priority, number> = {
  EMERGENCY: 15,
  MEDIUM: 4 * 60,
  LOW: 24 * 60,
};

export interface SlaState {
  /** The policy for this priority, in minutes. */
  responseMinutes: number;
  /** When acknowledgement was due. */
  targetAt: Date;
  /** When it was actually acknowledged, if it has been. */
  respondedAt: Date | null;
  /**
   * Minutes from report to acknowledgement — or to now, while it is
   * still waiting. An open alert's elapsed time keeps climbing, which
   * is the number somebody watching the queue wants.
   */
  elapsedMinutes: number;
  /**
   * Whether the window was missed. An alert still open past its target
   * has already breached: waiting to find out is how a breach goes
   * unnoticed until someone reads a report a month later.
   */
  breached: boolean;
}

const MINUTE = 60_000;

export function slaFor(
  priority: Priority,
  openedAt: Date,
  acknowledgedAt: Date | null,
  now: Date = new Date()
): SlaState {
  const responseMinutes = SLA_RESPONSE_MINUTES[priority];
  const targetAt = new Date(openedAt.getTime() + responseMinutes * MINUTE);
  const measuredTo = acknowledgedAt ?? now;

  return {
    responseMinutes,
    targetAt,
    respondedAt: acknowledgedAt,
    elapsedMinutes: Math.max(0, Math.round((measuredTo.getTime() - openedAt.getTime()) / MINUTE)),
    breached: measuredTo.getTime() > targetAt.getTime(),
  };
}
