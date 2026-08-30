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

export type Role = "ADMIN" | "ENGINEER" | "STAFF" | "MANAGER";

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
  warrantyEndsAt: string | null;
  purchasePrice: string | null;
  category: { name: string };
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
  recipient?: { id: string; fullName: string } | null;
}

// -------------------------------------------------------- formatting

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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

  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      field: key,
      label: AUDIT_FIELD_LABELS[key] ?? humanise(key),
      from: auditValue(key, before[key]),
      to: auditValue(key, after[key]),
    }));
}
