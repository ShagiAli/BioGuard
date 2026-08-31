/**
 * Live scheduler state, and the rule for deciding whether the nightly
 * sweep has gone quiet.
 *
 * index.ts owns the scheduler and app.ts owns the routes, and neither
 * imports the other — that separation is what lets tests mount the app
 * with supertest without starting a scheduler. This module is the small
 * piece of shared state between them: index.ts writes it, app.ts reads
 * it.
 *
 * Liveness is judged by staleness rather than by error reporting. A
 * process that has died cannot log its own failure, but the absence of a
 * recent run is visible from outside. That is the failure this exists to
 * catch: the API stays up and serving while reminders quietly stop, which
 * SECURITY.md calls the worst outcome for a system people trust.
 */

/** The sweep runs at 02:00 daily, so a gap beyond a day and a bit is wrong. */
export const SWEEP_STALE_AFTER_HOURS = 26;

const HOUR_MS = 3_600_000;

export interface SchedulerState {
  running: boolean;
  /** When the current process got the scheduler up. */
  startedAt: Date | null;
  /** Why it is not running, when we know. */
  lastError: string | null;
}

const state: SchedulerState = {
  running: false,
  startedAt: null,
  lastError: null,
};

export function markSchedulerStarted(at: Date = new Date()): void {
  state.running = true;
  state.startedAt = at;
  state.lastError = null;
}

export function markSchedulerFailed(error: unknown): void {
  state.running = false;
  state.startedAt = null;
  state.lastError = error instanceof Error ? error.message : String(error);
}

export function schedulerState(): Readonly<SchedulerState> {
  return state;
}

export type SweepFreshness = "fresh" | "stale" | "unknown";

/**
 * Whether the last successful sweep is recent enough.
 *
 * `unknown` rather than `stale` when nothing has ever run and the process
 * is younger than the threshold: a deployment that came up an hour ago
 * has not missed anything yet, and alarming on every fresh deploy is how
 * an alert gets ignored. Once the process has been up longer than the
 * window with no sweep, that is a real fault.
 */
export function sweepFreshness(
  lastSweepAt: Date | null,
  processStartedAt: Date | null,
  now: Date = new Date()
): SweepFreshness {
  const cutoff = now.getTime() - SWEEP_STALE_AFTER_HOURS * HOUR_MS;

  if (lastSweepAt) return lastSweepAt.getTime() >= cutoff ? "fresh" : "stale";
  if (!processStartedAt) return "unknown";
  return processStartedAt.getTime() <= cutoff ? "stale" : "unknown";
}
