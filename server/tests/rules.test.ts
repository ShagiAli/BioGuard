/**
 * The scheduling rules are the part of BioGuard that is easy to get
 * subtly wrong and hard to notice, so they are the part with tests.
 */
import { describe, expect, it } from "vitest";
import { daysBetween, graceDays, pmState, recalculateDue, thresholdFor } from "../src/scheduler/rules.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("grace window", () => {
  const base = { scheduleMode: "GRACE" as const, intervalDays: 90 };

  it("keeps the original anchor when work is on time", () => {
    const r = recalculateDue({ ...base, previousDue: d("2026-08-14"), completedOn: d("2026-08-14") });
    expect(r.nextDue.toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(r.rebased).toBe(false);
    expect(r.latenessDays).toBe(0);
  });

  it("keeps the anchor for a small delay inside the window", () => {
    // 90-day interval gives an 18-day window; 10 days late stays anchored.
    const r = recalculateDue({ ...base, previousDue: d("2026-08-14"), completedOn: d("2026-08-24") });
    expect(r.nextDue.toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(r.rebased).toBe(false);
  });

  it("re-bases once the delay passes the window", () => {
    const r = recalculateDue({ ...base, previousDue: d("2026-08-14"), completedOn: d("2026-09-15") });
    expect(r.rebased).toBe(true);
    expect(r.latenessDays).toBe(32);
    expect(r.nextDue.toISOString().slice(0, 10)).toBe("2026-12-14");
  });

  it("keeps the anchor when work is done early", () => {
    const r = recalculateDue({ ...base, previousDue: d("2026-08-14"), completedOn: d("2026-08-01") });
    expect(r.rebased).toBe(false);
    expect(r.latenessDays).toBe(-13);
    expect(r.nextDue.toISOString().slice(0, 10)).toBe("2026-11-12");
  });

  it("never re-bases an anchored schedule, however late", () => {
    const r = recalculateDue({
      scheduleMode: "ANCHORED",
      intervalDays: 365,
      previousDue: d("2026-08-14"),
      completedOn: d("2026-10-30"),
    });
    expect(r.rebased).toBe(false);
    expect(r.nextDue.toISOString().slice(0, 10)).toBe("2027-08-14");
  });

  it("schedules from the completion date on a first service", () => {
    const r = recalculateDue({ ...base, previousDue: null, completedOn: d("2026-08-14") });
    expect(r.nextDue.toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(r.latenessDays).toBeNull();
  });

  it("respects a per-device grace override", () => {
    expect(graceDays(90)).toBe(18);
    expect(graceDays(90, 3)).toBe(3);
    const r = recalculateDue({
      ...base,
      graceDaysOverride: 3,
      previousDue: d("2026-08-14"),
      completedOn: d("2026-08-24"),
    });
    expect(r.rebased).toBe(true);
  });
});

describe("reminder ladder", () => {
  const due = d("2026-09-13");

  it("fires on each rung and nowhere else", () => {
    expect(thresholdFor(due, d("2026-08-14"))?.at).toBe(30);
    expect(thresholdFor(due, d("2026-08-30"))?.at).toBe(14);
    expect(thresholdFor(due, d("2026-09-06"))?.at).toBe(7);
    expect(thresholdFor(due, d("2026-09-12"))?.at).toBe(1);
    expect(thresholdFor(due, d("2026-09-13"))?.at).toBe(0);
    expect(thresholdFor(due, d("2026-08-20"))).toBeNull();
  });

  it("escalates the first day overdue, then weekly", () => {
    expect(thresholdFor(due, d("2026-09-14"))?.level).toBe("OVERDUE");
    expect(thresholdFor(due, d("2026-09-20"))?.level).toBe("OVERDUE"); // 7 days
    expect(thresholdFor(due, d("2026-09-16"))).toBeNull(); // 3 days, silent
  });

  it("ignores devices with no schedule", () => {
    expect(thresholdFor(null, d("2026-09-13"))).toBeNull();
  });
});

describe("derived state", () => {
  const today = d("2026-08-14");

  it("classifies by days remaining", () => {
    expect(pmState(d("2026-08-13"), today)).toBe("OVERDUE");
    expect(pmState(d("2026-08-14"), today)).toBe("DUE_NOW");
    expect(pmState(d("2026-08-21"), today)).toBe("DUE_NOW");
    expect(pmState(d("2026-08-22"), today)).toBe("DUE_SOON");
    expect(pmState(d("2026-09-13"), today)).toBe("DUE_SOON");
    expect(pmState(d("2026-09-14"), today)).toBe("SCHEDULED");
    expect(pmState(null, today)).toBe("UNSCHEDULED");
  });

  it("counts calendar days across a DST boundary", () => {
    // Türkiye holds UTC+3 year round, but the server may not. Day
    // arithmetic must not drift by an hour either way.
    expect(daysBetween(d("2026-03-28"), d("2026-03-29"))).toBe(1);
    expect(daysBetween(d("2026-10-24"), d("2026-10-25"))).toBe(1);
  });
});
