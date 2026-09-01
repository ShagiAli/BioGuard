/**
 * The alert and work-order state machines.
 *
 * These decide who may do what and when, so they are worth pinning down
 * exhaustively rather than by example. Pure, so no database is needed.
 */
import { describe, expect, it } from "vitest";
import type { AlertStatus, Role, WorkOrderStatus } from "@prisma/client";
import {
  alertNumber,
  canEditWorkOrder,
  canMoveWorkOrder,
  canTransitionAlert,
  deviceStatusFor,
  isAlertClosed,
  maintenanceTypeFor,
  notifyLevelFor,
  workOrderNumber,
} from "../src/modules/alerts/workflow.js";

const ROLES: Role[] = ["ADMIN", "ENGINEER", "STAFF", "MANAGER", "HEAD_OF_ALERTS"];
const ALERT_STATUSES: AlertStatus[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CANCELLED",
];

describe("alert transitions", () => {
  it("lets the head of alerts acknowledge a new alert", () => {
    expect(canTransitionAlert("acknowledge", "OPEN", "HEAD_OF_ALERTS")).toEqual({
      ok: true,
      next: "ACKNOWLEDGED",
    });
  });

  it("refuses a nurse the triage actions", () => {
    // The nurse raises the alert; she does not decide it has been received.
    for (const action of ["acknowledge", "assign", "cancel"] as const) {
      const r = canTransitionAlert(action, "OPEN", "STAFF");
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/role does not allow/);
    }
  });

  it("refuses a manager the triage actions", () => {
    // MANAGER oversees the preventive programme. Watching maintenance
    // drift must not confer the power to assign work.
    expect(canTransitionAlert("assign", "ACKNOWLEDGED", "MANAGER").ok).toBe(false);
  });

  it("will not acknowledge twice", () => {
    const r = canTransitionAlert("acknowledge", "ACKNOWLEDGED", "HEAD_OF_ALERTS");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/acknowledged/);
  });

  it("allows re-assignment, because engineers leave", () => {
    expect(canTransitionAlert("assign", "ASSIGNED", "HEAD_OF_ALERTS").ok).toBe(true);
  });

  it("will not assign before the alert is acknowledged", () => {
    expect(canTransitionAlert("assign", "OPEN", "HEAD_OF_ALERTS").ok).toBe(false);
  });

  it("refuses to cancel once work is under way", () => {
    // A started job ends in a work order recording what was found, not in
    // a cancellation that erases it.
    expect(canTransitionAlert("cancel", "IN_PROGRESS", "ADMIN").ok).toBe(false);
    expect(canTransitionAlert("cancel", "ASSIGNED", "ADMIN").ok).toBe(true);
  });

  it("distinguishes a forbidden role from an impossible moment", () => {
    // A caller told the wrong one goes looking in the wrong place.
    expect(canTransitionAlert("acknowledge", "OPEN", "ENGINEER").reason).toMatch(/role/);
    expect(canTransitionAlert("acknowledge", "RESOLVED", "ADMIN").reason).toMatch(/cannot be/);
  });

  it("lets nothing act on a finished alert", () => {
    for (const status of ["RESOLVED", "CANCELLED"] as const) {
      for (const role of ROLES) {
        for (const action of ["acknowledge", "assign", "start", "resolve", "cancel"] as const) {
          expect(canTransitionAlert(action, status, role).ok).toBe(false);
        }
      }
    }
  });

  it("rejects an unknown action rather than defaulting to allowed", () => {
    // @ts-expect-error deliberately outside the union
    expect(canTransitionAlert("delete", "OPEN", "ADMIN").ok).toBe(false);
  });

  it("marks only the terminal states closed", () => {
    for (const s of ALERT_STATUSES) {
      expect(isAlertClosed(s)).toBe(s === "RESOLVED" || s === "CANCELLED");
    }
  });
});

describe("work order transitions", () => {
  it("walks the ordinary repair path", () => {
    expect(canMoveWorkOrder("INVESTIGATING", "IN_REPAIR").ok).toBe(true);
    expect(canMoveWorkOrder("IN_REPAIR", "COMPLETED").ok).toBe(true);
    expect(canMoveWorkOrder("COMPLETED", "CLOSED").ok).toBe(true);
  });

  it("walks the parts detour and back", () => {
    expect(canMoveWorkOrder("INVESTIGATING", "AWAITING_PARTS").ok).toBe(true);
    expect(canMoveWorkOrder("AWAITING_PARTS", "IN_REPAIR").ok).toBe(true);
  });

  it("refuses to close without completing first", () => {
    expect(canMoveWorkOrder("INVESTIGATING", "CLOSED").ok).toBe(false);
    expect(canMoveWorkOrder("IN_REPAIR", "CLOSED").ok).toBe(false);
  });

  it("treats closed and cancelled as terminal", () => {
    const terminal: WorkOrderStatus[] = ["CLOSED", "CANCELLED"];
    const every: WorkOrderStatus[] = [
      "INVESTIGATING",
      "AWAITING_PARTS",
      "IN_REPAIR",
      "COMPLETED",
      "CLOSED",
      "CANCELLED",
    ];
    for (const from of terminal) {
      for (const to of every) {
        if (from === to) continue;
        expect(canMoveWorkOrder(from, to).ok).toBe(false);
      }
    }
  });

  it("allows reopening a completed order that turned out not to be fixed", () => {
    expect(canMoveWorkOrder("COMPLETED", "IN_REPAIR").ok).toBe(true);
  });

  it("treats a move to the same status as a no-op, not an error", () => {
    expect(canMoveWorkOrder("IN_REPAIR", "IN_REPAIR").ok).toBe(true);
  });
});

describe("editing after close", () => {
  it("is open to everyone while the order is live", () => {
    for (const role of ROLES) {
      expect(canEditWorkOrder("IN_REPAIR", role).ok).toBe(true);
    }
  });

  it("is administrator-only once closed", () => {
    expect(canEditWorkOrder("CLOSED", "ADMIN").ok).toBe(true);
    for (const role of ROLES.filter((r) => r !== "ADMIN")) {
      const r = canEditWorkOrder("CLOSED", role);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/administrator/);
    }
  });
});

describe("device status follows the work order", () => {
  it("shows a device as under repair or awaiting parts while work is live", () => {
    expect(deviceStatusFor("INVESTIGATING")).toBe("UNDER_REPAIR");
    expect(deviceStatusFor("IN_REPAIR")).toBe("UNDER_REPAIR");
    expect(deviceStatusFor("AWAITING_PARTS")).toBe("AWAITING_PARTS");
  });

  it("returns the device to service when the work finishes", () => {
    expect(deviceStatusFor("COMPLETED")).toBe("OPERATIONAL");
    expect(deviceStatusFor("CLOSED")).toBe("OPERATIONAL");
  });

  it("leaves the device alone when the work order is cancelled", () => {
    // Nobody looked at it, so declaring it operational would be a lie.
    expect(deviceStatusFor("CANCELLED")).toBeNull();
  });
});

describe("priority mapping", () => {
  it("escalates the notification with the priority", () => {
    expect(notifyLevelFor("EMERGENCY")).toBe("URGENT");
    expect(notifyLevelFor("MEDIUM")).toBe("WARNING");
    expect(notifyLevelFor("LOW")).toBe("INFO");
  });

  it("records an emergency repair as such in device history", () => {
    expect(maintenanceTypeFor("EMERGENCY")).toBe("EMERGENCY");
    expect(maintenanceTypeFor("MEDIUM")).toBe("CORRECTIVE");
    expect(maintenanceTypeFor("LOW")).toBe("CORRECTIVE");
  });
});

describe("reference numbers", () => {
  const on = new Date("2026-08-31T10:00:00.000Z");

  it("pads to a stable width", () => {
    expect(alertNumber(1, on)).toBe("ALT-2026-000001");
    expect(alertNumber(123, on)).toBe("ALT-2026-000123");
    expect(workOrderNumber(45, on)).toBe("WO-2026-000045");
  });

  it("does not truncate once past the padding", () => {
    expect(alertNumber(1234567, on)).toBe("ALT-2026-1234567");
  });

  it("takes the year from the record, not from today", () => {
    expect(alertNumber(7, new Date("2025-01-02T00:00:00.000Z"))).toBe("ALT-2025-000007");
  });
});
