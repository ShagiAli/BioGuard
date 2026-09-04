/**
 * The response-time rule.
 *
 * Pure, so it runs without a database — which is the point of deriving
 * it rather than storing it. The cases worth pinning are the boundary
 * and the still-open alert, because those are the two the reporting
 * gets wrong when this is written casually.
 */
import { describe, expect, it } from "vitest";
import { SLA_RESPONSE_MINUTES, slaFor } from "../src/lib/sla.js";

const opened = new Date("2026-05-12T09:02:00.000Z");
const minutesAfter = (n: number) => new Date(opened.getTime() + n * 60_000);

describe("response targets", () => {
  it("gives an emergency the tightest window", () => {
    expect(SLA_RESPONSE_MINUTES.EMERGENCY).toBeLessThan(SLA_RESPONSE_MINUTES.MEDIUM);
    expect(SLA_RESPONSE_MINUTES.MEDIUM).toBeLessThan(SLA_RESPONSE_MINUTES.LOW);
  });

  it("counts the target from the moment it was reported", () => {
    const sla = slaFor("EMERGENCY", opened, null, opened);
    expect(sla.targetAt).toEqual(minutesAfter(15));
  });
});

describe("whether the window was met", () => {
  it("is met when acknowledged inside it", () => {
    const sla = slaFor("EMERGENCY", opened, minutesAfter(8), minutesAfter(30));
    expect(sla.breached).toBe(false);
    expect(sla.elapsedMinutes).toBe(8);
  });

  it("is met exactly on the target", () => {
    // Landing on the boundary is not late.
    const sla = slaFor("EMERGENCY", opened, minutesAfter(15), minutesAfter(30));
    expect(sla.breached).toBe(false);
  });

  it("is missed a minute past it", () => {
    const sla = slaFor("EMERGENCY", opened, minutesAfter(16), minutesAfter(30));
    expect(sla.breached).toBe(true);
    expect(sla.elapsedMinutes).toBe(16);
  });

  it("measures an unacknowledged alert against now, and keeps climbing", () => {
    // The number someone watching the queue wants is how long it has
    // been waiting, not a blank.
    expect(slaFor("MEDIUM", opened, null, minutesAfter(30)).elapsedMinutes).toBe(30);
    expect(slaFor("MEDIUM", opened, null, minutesAfter(90)).elapsedMinutes).toBe(90);
  });

  it("breaches while still open, without waiting to be acknowledged", () => {
    // An alert nobody has touched is the one most likely to have
    // breached. Reporting it as fine until somebody finally opens it is
    // how a breach goes unnoticed for a month.
    const sla = slaFor("EMERGENCY", opened, null, minutesAfter(40));
    expect(sla.breached).toBe(true);
    expect(sla.respondedAt).toBeNull();
  });

  it("never reports negative elapsed time", () => {
    // Clock skew between the database and the server should not produce
    // an alert acknowledged before it was reported.
    expect(slaFor("LOW", opened, minutesAfter(-5), opened).elapsedMinutes).toBe(0);
  });
});
