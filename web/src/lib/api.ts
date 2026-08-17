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
  const data = text ? JSON.parse(text) : null;

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
