/**
 * Thin API client.
 *
 * `credentials: "include"` on every call is what carries the session
 * cookie. Vite proxies /api to the server in development, so the
 * browser stays on one origin and the cookie is first-party.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();

  // Not every response is JSON. A proxy timeout or an HTML error page
  // would otherwise throw a parse error and surface as "could not reach
  // the server", hiding what actually happened.
  // No initialiser: every path out of the catch throws, so the only way
  // to reach the code below is through a successful assignment.
  let data: { error?: string } | null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new ApiError(res.status, text.slice(0, 200) || res.statusText);
    throw new ApiError(res.status, "The server returned an unexpected response.");
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "Something went wrong.");
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ------------------------------------------------------------- types

export type Role = "ADMIN" | "ENGINEER" | "STAFF" | "MANAGER" | "HEAD_OF_ALERTS";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  departmentId: string | null;
}

export type PmState = "OVERDUE" | "DUE_NOW" | "DUE_SOON" | "SCHEDULED" | "UNSCHEDULED";

export type OperationalStatus =
  | "OPERATIONAL"
  | "UNDER_MAINTENANCE"
  | "UNDER_REPAIR"
  | "AWAITING_PARTS"
  | "OUT_OF_SERVICE"
  | "RETIRED";

export interface EquipmentRow {
  id: string;
  tag: string;
  assetNo: string;
  name: string;
  model: string;
  serialNo: string;
  criticality: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  operationalStatus: OperationalStatus;
  intervalDays: number;
  scheduleMode: "GRACE" | "ANCHORED";
  lastCompletedAt: string | null;
  nextDueAt: string | null;
  pmState: PmState;
  department: { name: string };
  manufacturer: { name: string };
  engineer: { id: string; fullName: string } | null;
  room: { code: string; floor: number; building: { name: string } } | null;
}

export interface MaintenanceRecord {
  id: string;
  type: string;
  completedOn: string;
  workPerformed: string;
  findings: string | null;
  problem: string | null;
  cost: string | null;
  downtimeHours: number;
  latenessDays: number | null;
  rebased: boolean;
  nextDueAfter: string | null;
  engineer?: { fullName: string };
}

export interface EquipmentDetail extends EquipmentRow {
  intervalSource: string;
  graceDaysOverride: number | null;
  /** Computed server-side from the scheduling rules, never re-derived here. */
  graceWindow: number;
  installedAt: string | null;
  purchasedAt: string | null;
  /** The object key, not a link. Links are signed per view and expire. */
  photoPath: string | null;
  /** False where the deployment has nowhere to put a file. */
  photoUploadAvailable: boolean;
  warrantyEndsAt: string | null;
  purchasePrice: string | null;
  /**
   * The detail endpoint includes whole relations, so the ids are there
   * to be read. They were not declared until the edit form needed to
   * pre-select a dropdown, which cannot be done from a name.
   */
  category: { id: string; name: string };
  manufacturer: { id: string; name: string };
  department: { id: string; name: string };
  room: { id: string; code: string; floor: number; building: { name: string } } | null;
  maintenance: MaintenanceRecord[];
}

export interface Summary {
  total: number;
  operational: number;
  due30: number;
  overdue: number;
  criticalOverdue: number;
}

export interface Notification {
  id: string;
  level: "INFO" | "WARNING" | "URGENT" | "DUE" | "OVERDUE";
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  equipment: { id: string; name: string; assetNo: string } | null;
  /**
   * Set when the reminder came from a reported fault rather than the
   * preventive schedule. The row's own foreign key is the category;
   * there is no stored one.
   */
  alertId: string | null;
  recipient?: { id: string; fullName: string } | null;
}

// -------------------------------------------------------- formatting

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Date with the time, for anywhere the order of events is the point.
 *
 * An alert can be reported, triaged, assigned and acknowledged inside
 * one morning, and a timeline showing four identical dates says nothing
 * about the sequence it exists to show.
 *
 * Read in UTC like formatDate, so the two never disagree about which day
 * something happened.
 */
export function formatDateTime(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(d.toISOString())}, ${hh}:${mm}`;
}

/**
 * Minutes as something a person reads at a glance.
 *
 * Response times run from a quarter of an hour to a working day, so the
 * unit has to change with the size: "15m", "4h", "1d 4h". Rendering
 * 1440 minutes as "1440m" is technically true and useless on a queue
 * somebody is scanning.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/** Whole days from today until the given date, in UTC calendar days. */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((new Date(iso).getTime() - today) / 86_400_000);
}

export function formatMoney(value: string | null): string {
  if (value === null) return "—";
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export const PM_LABELS: Record<PmState, string> = {
  OVERDUE: "Overdue",
  DUE_NOW: "Due now",
  DUE_SOON: "Due soon",
  SCHEDULED: "Scheduled",
  UNSCHEDULED: "Not scheduled",
};

export const STATUS_LABELS: Record<OperationalStatus, string> = {
  OPERATIONAL: "Operational",
  UNDER_MAINTENANCE: "Under maintenance",
  UNDER_REPAIR: "Under repair",
  AWAITING_PARTS: "Awaiting parts",
  OUT_OF_SERVICE: "Out of service",
  RETIRED: "Retired",
};

/**
 * The maintenance types the API accepts, in the order the schema
 * declares them. Kept as one list so a form cannot quietly offer a
 * subset — EMERGENCY was missing from the record dialog for exactly
 * that reason.
 */
export const MAINTENANCE_TYPES = [
  "PREVENTIVE",
  "CORRECTIVE",
  "EMERGENCY",
  "CALIBRATION",
  "INSPECTION",
  "SAFETY_TEST",
] as const;

/**
 * Mirrors canSeeCosts() in the server's auth middleware.
 *
 * Written as the same explicit allowlist rather than `role !==
 * "STAFF"`. The two are equivalent for today's four roles and would
 * diverge the moment a fifth is added, with the UI showing a field the
 * API strips.
 */
export function canSeeCosts(role: Role | undefined): boolean {
  return role === "ADMIN" || role === "ENGINEER" || role === "MANAGER";
}

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
}

// ------------------------------------------------------ audit + health

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  actor: { fullName: string } | null;
  equipment?: { id: string; name: string; assetNo: string } | null;
}

export interface SweepRun {
  id: string;
  ranFor: string;
  scanned: number;
  sent: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface SchedulerHealth {
  running: boolean;
  startedAt: string | null;
  lastError: string | null;
  freshness: "fresh" | "stale" | "unknown";
  staleAfterHours: number;
  lastSweepAt: string | null;
  lastSweepFor: string | null;
  recent: SweepRun[];
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "equipment.status_changed": "Status changed",
  "maintenance.recorded": "Maintenance recorded",
  "maintenance.recorded_rebased": "Schedule re-based",
};

const AUDIT_FIELD_LABELS: Record<string, string> = {
  operationalStatus: "Status",
  criticality: "Criticality",
  nextDueAt: "Next due",
  lastCompletedAt: "Last completed",
  intervalDays: "Interval",
  scheduleMode: "Schedule rule",
  engineerId: "Responsible engineer",
  departmentId: "Department",
  roomId: "Room",
  assetNo: "Asset number",
  completedOn: "Completed on",
  downtimeHours: "Downtime",
  rebased: "Schedule re-based",
  nextDueAfter: "Next due after",
};

/** camelCase to something readable, for any field without an explicit label. */
const humanise = (key: string) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

function auditValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (field === "operationalStatus") {
    return STATUS_LABELS[value as OperationalStatus] ?? String(value);
  }
  if (/(At|On|After)$/.test(field)) return formatDate(String(value));
  if (typeof value === "boolean") return value ? "Yes" : "No";
  // Enum members arrive as SCREAMING_SNAKE_CASE.
  if (typeof value === "string" && /^[A-Z][A-Z_]*$/.test(value)) return titleCase(value);
  return String(value);
}

export interface AuditChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

/**
 * The fields that actually differ between before and after.
 *
 * The audit writer stores a fixed allowlist per entity, so both sides
 * carry the same keys whether or not they changed. Showing all of them
 * would bury the one that moved.
 */
export function auditChanges(entry: AuditEntry): AuditChange[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  // undefined and null both mean "absent", and they differ constantly on
  // a creation event, where there is no `before` at all. Comparing them
  // literally reports every empty optional field as a change.
  const same = (a: unknown, b: unknown) =>
    (a ?? null) === null && (b ?? null) === null
      ? true
      : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  return keys
    .filter((key) => !same(before[key], after[key]))
    // Foreign keys stay in the audit table for forensics, but a bare
    // UUID tells a reader nothing. Who something was assigned to is
    // shown by name on the record itself; here it would only be noise.
    .filter((key) => !/Id$/.test(key))
    .map((key) => ({
      field: key,
      label: AUDIT_FIELD_LABELS[key] ?? humanise(key),
      from: auditValue(key, before[key]),
      to: auditValue(key, after[key]),
    }));
}

// ------------------------------------------- alerts and work orders

export type Priority = "EMERGENCY" | "MEDIUM" | "LOW";

export type AlertStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CANCELLED";

export type WorkOrderStatus =
  | "INVESTIGATING"
  | "AWAITING_PARTS"
  | "IN_REPAIR"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELLED";

export interface Alert {
  id: string;
  number: string;
  description: string;
  priority: Priority;
  status: AlertStatus;
  openedAt: string;
  acknowledgedAt: string | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  cancelledReason: string | null;
  equipment: {
    id: string;
    name: string;
    assetNo: string;
    operationalStatus: OperationalStatus;
    department: { name: string };
    room: { code: string } | null;
  };
  raisedBy: { id: string; fullName: string };
  acknowledgedBy: { id: string; fullName: string } | null;
  /**
   * Derived by the server from the two timestamps below, never stored.
   * The client does not re-derive it: the response window is policy, and
   * a second copy of a policy is a second answer.
   */
  sla: {
    responseMinutes: number;
    targetAt: string;
    respondedAt: string | null;
    elapsedMinutes: number;
    breached: boolean;
  };
  assignedTo: { id: string; fullName: string } | null;
  workOrder: {
    id: string;
    seq: number;
    status: WorkOrderStatus;
    createdAt: string;
    parts: Pick<WorkOrderPart, "id" | "name" | "quantity" | "status" | "orderedAt">[];
  } | null;
  duplicateOf?: { id: string; number: string } | null;
}

export interface WorkOrder {
  id: string;
  number: string;
  status: WorkOrderStatus;
  priority: Priority;
  findings: string | null;
  diagnosis: string | null;
  repairActions: string | null;
  finalResolution: string | null;
  createdAt: string;
  completedAt: string | null;
  closedAt: string | null;
  labourHours: string | null;
  maintenanceRecordId: string | null;
  alert: {
    id: string;
    description: string;
    priority: Priority;
    status: AlertStatus;
    raisedBy: { id: string; fullName: string };
  };
  parts: WorkOrderPart[];
  equipment: {
    id: string;
    name: string;
    assetNo: string;
    operationalStatus: OperationalStatus;
    department: { name: string };
  };
  engineer: { id: string; fullName: string };
  closedBy: { id: string; fullName: string } | null;
}

export type PartStatus =
  | "REQUIRED"
  | "REQUESTED"
  | "ORDERED"
  | "RECEIVED"
  | "INSTALLED"
  | "CANCELLED";

export interface WorkOrderPart {
  id: string;
  name: string;
  partNumber: string | null;
  quantity: number;
  status: PartStatus;
  notes: string | null;
  requestedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  installedAt: string | null;
  cancelledAt: string | null;
}

/** The rung a part may climb to next; empty once it is finished. */
export const NEXT_PART_STATUS: Record<PartStatus, PartStatus | null> = {
  REQUIRED: "REQUESTED",
  REQUESTED: "ORDERED",
  ORDERED: "RECEIVED",
  RECEIVED: "INSTALLED",
  INSTALLED: null,
  CANCELLED: null,
};

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  REQUIRED: "Required",
  REQUESTED: "Requested",
  ORDERED: "Ordered",
  RECEIVED: "Received",
  INSTALLED: "Installed",
  CANCELLED: "Cancelled",
};

/** The button that advances a part says what it does, not where it lands. */
export const PART_ADVANCE_LABELS: Record<PartStatus, string> = {
  REQUIRED: "Request",
  REQUESTED: "Mark ordered",
  ORDERED: "Mark received",
  RECEIVED: "Mark installed",
  INSTALLED: "",
  CANCELLED: "",
};

export function partTone(status: PartStatus): "emerald" | "amber" | "sky" | "slate" {
  if (status === "INSTALLED") return "emerald";
  if (status === "CANCELLED") return "slate";
  if (status === "REQUIRED") return "amber";
  return "sky";
}

export function isPartOutstanding(status: PartStatus): boolean {
  return status !== "INSTALLED" && status !== "CANCELLED";
}

export interface WorkOrderSummary {
  inProgress: number;
  awaitingParts: number;
  partsOrdered: number;
  closed: number;
}

export interface AlertSummary {
  open: number;
  emergency: number;
  medium: number;
  low: number;
  awaitingAssignment: number;
  inProgress: number;
}

export const PRIORITIES: Priority[] = ["EMERGENCY", "MEDIUM", "LOW"];

export const PRIORITY_LABELS: Record<Priority, string> = {
  EMERGENCY: "Emergency",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Received",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "Under investigation",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  INVESTIGATING: "Investigating",
  AWAITING_PARTS: "Awaiting parts",
  IN_REPAIR: "In repair",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** Emergency reads red, medium amber, low neutral — the same tones as PM state. */
export function priorityTone(priority: Priority): "rose" | "amber" | "slate" {
  if (priority === "EMERGENCY") return "rose";
  if (priority === "MEDIUM") return "amber";
  return "slate";
}

export function alertStatusTone(status: AlertStatus): "emerald" | "sky" | "amber" | "slate" {
  if (status === "RESOLVED") return "emerald";
  if (status === "CANCELLED") return "slate";
  if (status === "OPEN") return "amber";
  return "sky";
}

/** Who triages: mirrors triagesAlerts() on the server. */
export function triagesAlerts(role: Role | undefined): boolean {
  return role === "ADMIN" || role === "HEAD_OF_ALERTS";
}
