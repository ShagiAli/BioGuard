/**
 * The alert and work-order state machines.
 *
 * Everything here is pure: no database, no clock, no request. Routes ask
 * whether a move is legal and are told; they never assign a status
 * themselves. That is the whole point — a status column any endpoint can
 * write becomes untraceable within a month, and "who was allowed to do
 * what" ends up scattered across a dozen handlers instead of stated once.
 *
 * Same shape as scheduler/rules.ts, and tested the same way.
 */

import type {
  AlertStatus,
  OperationalStatus,
  Priority,
  Role,
  WorkOrderStatus,
} from "@prisma/client";

// ------------------------------------------------------------- alerts

/** Who may perform each alert transition, and from where. */
interface AlertTransition {
  from: readonly AlertStatus[];
  to: AlertStatus;
  roles: readonly Role[];
}

const ALERT_TRANSITIONS = {
  acknowledge: {
    from: ["OPEN"],
    to: "ACKNOWLEDGED",
    roles: ["HEAD_OF_ALERTS", "ADMIN"],
  },
  assign: {
    // Re-assignment is allowed: an engineer can leave, or the first
    // choice can turn out to be the wrong one.
    from: ["ACKNOWLEDGED", "ASSIGNED"],
    to: "ASSIGNED",
    roles: ["HEAD_OF_ALERTS", "ADMIN"],
  },
  start: {
    // Driven by the engineer opening a work order, not clicked directly.
    from: ["ASSIGNED"],
    to: "IN_PROGRESS",
    roles: ["ENGINEER", "ADMIN"],
  },
  resolve: {
    // Driven by closing the work order.
    from: ["IN_PROGRESS"],
    to: "RESOLVED",
    roles: ["ENGINEER", "ADMIN"],
  },
  cancel: {
    // Only before an engineer has started. Once there is work in
    // progress the honest ending is a closed work order recording what
    // was found, not a cancellation that erases it.
    from: ["OPEN", "ACKNOWLEDGED", "ASSIGNED"],
    to: "CANCELLED",
    roles: ["HEAD_OF_ALERTS", "ADMIN"],
  },
  // `satisfies` rather than a type annotation: the annotation would widen
  // keyof to `string`, and AlertAction would stop catching a typo at the
  // call site — which is most of the value of having the type.
} satisfies Record<string, AlertTransition>;

export type AlertAction = keyof typeof ALERT_TRANSITIONS;

export interface TransitionResult {
  ok: boolean;
  /** Status to write when ok. */
  next?: AlertStatus;
  /** Why not, phrased for the person who tried it. */
  reason?: string;
}

/**
 * Whether `role` may take `action` on an alert currently at `status`.
 *
 * The role check and the status check are deliberately separate, so the
 * message distinguishes "you may not do this" from "this cannot be done
 * now" — a caller who is told the wrong one goes looking in the wrong
 * place.
 */
export function canTransitionAlert(
  action: AlertAction,
  status: AlertStatus,
  role: Role
): TransitionResult {
  // Widened deliberately: `satisfies` above keeps keyof narrow so a typo
  // is a compile error, but it also infers each `from`/`roles` as a
  // literal tuple, which would reject an ordinary Role here.
  const rule: AlertTransition | undefined = ALERT_TRANSITIONS[action];
  if (!rule) return { ok: false, reason: "Unknown action." };

  if (!rule.roles.includes(role)) {
    return { ok: false, reason: "Your role does not allow this action." };
  }
  if (!rule.from.includes(status)) {
    return {
      ok: false,
      reason: `An alert that is ${humanStatus(status)} cannot be ${PAST_TENSE[action]}.`,
    };
  }
  return { ok: true, next: rule.to };
}

const PAST_TENSE: Record<AlertAction, string> = {
  acknowledge: "acknowledged",
  assign: "assigned",
  start: "started",
  resolve: "resolved",
  cancel: "cancelled",
};

function humanStatus(status: AlertStatus | WorkOrderStatus): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/** Terminal states. Nothing further happens to an alert here. */
export function isAlertClosed(status: AlertStatus): boolean {
  return status === "RESOLVED" || status === "CANCELLED";
}

// -------------------------------------------------------- work orders

const WORK_ORDER_FLOW: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  INVESTIGATING: ["AWAITING_PARTS", "IN_REPAIR", "COMPLETED", "CANCELLED"],
  AWAITING_PARTS: ["IN_REPAIR", "INVESTIGATING", "CANCELLED"],
  IN_REPAIR: ["AWAITING_PARTS", "COMPLETED", "CANCELLED"],
  COMPLETED: ["CLOSED", "IN_REPAIR"],
  // Terminal. Reopening would defeat the archive's purpose; an
  // administrator edits in place instead, and the edit is audited.
  CLOSED: [],
  CANCELLED: [],
};

export function canMoveWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): TransitionResult {
  if (from === to) return { ok: true, next: undefined };
  if (WORK_ORDER_FLOW[from].includes(to)) return { ok: true };
  return {
    ok: false,
    reason: `A work order that is ${humanStatus(from)} cannot move to ${humanStatus(to)}.`,
  };
}

/**
 * A closed work order is read-only to everyone but an administrator.
 *
 * The requirement is explicit, and it is the reason the archive can be
 * trusted for reporting: history that anyone can revise is not history.
 * Administrator edits are still written to the audit log under their own
 * action name so they stand out rather than blending in.
 */
export function canEditWorkOrder(status: WorkOrderStatus, role: Role): TransitionResult {
  if (status !== "CLOSED") return { ok: true };
  if (role === "ADMIN") return { ok: true };
  return {
    ok: false,
    reason: "This work order is closed. Only an administrator can change it.",
  };
}

/**
 * The device status a work order implies.
 *
 * Returning it from here rather than setting it at each call site is what
 * keeps the equipment list honest without anyone having to remember: a
 * device being repaired says so, and says so again when it is back in
 * service.
 *
 * Null means "leave the device alone" — a cancelled work order should not
 * silently declare a device operational when nobody looked at it.
 */
export function deviceStatusFor(status: WorkOrderStatus): OperationalStatus | null {
  switch (status) {
    case "INVESTIGATING":
    case "IN_REPAIR":
      return "UNDER_REPAIR";
    case "AWAITING_PARTS":
      return "AWAITING_PARTS";
    case "COMPLETED":
    case "CLOSED":
      return "OPERATIONAL";
    case "CANCELLED":
      return null;
  }
}

// ------------------------------------------------------------ display

/** Priority drives the urgency of the notification it generates. */
export function notifyLevelFor(priority: Priority): "URGENT" | "WARNING" | "INFO" {
  if (priority === "EMERGENCY") return "URGENT";
  if (priority === "MEDIUM") return "WARNING";
  return "INFO";
}

/** Emergency repairs are recorded as such in the device's history. */
export function maintenanceTypeFor(priority: Priority): "EMERGENCY" | "CORRECTIVE" {
  return priority === "EMERGENCY" ? "EMERGENCY" : "CORRECTIVE";
}

/**
 * Human-facing reference numbers, derived rather than stored.
 *
 * The sequence is the source of truth; this is only its presentation, so
 * a number can never disagree with the row it belongs to.
 */
export function alertNumber(seq: number, openedAt: Date): string {
  return reference("ALT", seq, openedAt);
}

export function workOrderNumber(seq: number, createdAt: Date): string {
  return reference("WO", seq, createdAt);
}

function reference(prefix: string, seq: number, on: Date): string {
  return `${prefix}-${on.getUTCFullYear()}-${String(seq).padStart(6, "0")}`;
}
