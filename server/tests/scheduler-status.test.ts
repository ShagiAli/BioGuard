/**
 * The staleness rule behind the scheduler health check.
 *
 * This is the whole detection mechanism for the failure SECURITY.md
 * calls the one that matters most — reminders stopping while the API
 * carries on serving — so the boundaries are worth pinning down. Pure,
 * so it runs in the unit suite with no database.
 */
import { describe, expect, it } from "vitest";
import { SWEEP_STALE_AFTER_HOURS, sweepFreshness } from "../src/scheduler/status.js";

const now = new Date("2026-08-30T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("sweep freshness", () => {
  it("is fresh for a sweep inside the window", () => {
    expect(sweepFreshness(hoursAgo(1), hoursAgo(100), now)).toBe("fresh");
    expect(sweepFreshness(hoursAgo(SWEEP_STALE_AFTER_HOURS - 1), hoursAgo(100), now)).toBe("fresh");
  });

  it("is fresh exactly on the boundary", () => {
    // A sweep landing precisely on the cutoff has not yet been missed.
    expect(sweepFreshness(hoursAgo(SWEEP_STALE_AFTER_HOURS), hoursAgo(100), now)).toBe("fresh");
  });

  it("is stale once the window has passed", () => {
    expect(sweepFreshness(hoursAgo(SWEEP_STALE_AFTER_HOURS + 1), hoursAgo(100), now)).toBe("stale");
    // A daily job silent for a week is the case this exists to catch.
    expect(sweepFreshness(hoursAgo(168), hoursAgo(200), now)).toBe("stale");
  });

  it("is unknown on a young process that has never swept", () => {
    // A deployment that came up an hour ago has not missed anything yet.
    // Alarming here is how an alert gets trained into being ignored.
    expect(sweepFreshness(null, hoursAgo(1), now)).toBe("unknown");
  });

  it("is stale on an old process that has never swept", () => {
    // Up for days with no sweep is a real fault, not a young deployment.
    expect(sweepFreshness(null, hoursAgo(SWEEP_STALE_AFTER_HOURS + 1), now)).toBe("stale");
  });

  it("is unknown when the scheduler never started and nothing has run", () => {
    expect(sweepFreshness(null, null, now)).toBe("unknown");
  });

  it("judges on the last sweep, not on process age", () => {
    // A restarted process must not look stale because it is young, nor
    // fresh because it is old: only the sweep time decides.
    expect(sweepFreshness(hoursAgo(2), hoursAgo(0.1), now)).toBe("fresh");
    expect(sweepFreshness(hoursAgo(48), hoursAgo(0.1), now)).toBe("stale");
  });
});
