/**
 * The alert queue.
 *
 * What each person sees is decided by the API's alertScope, not here: a
 * nurse sees what she reported, an engineer what is assigned to them plus
 * their department, triage roles the lot. This page only renders it.
 *
 * Ordered by priority then age, so it reads as a work list rather than a
 * feed — the emergency raised an hour ago belongs above the low-priority
 * one from last week.
 *
 * Filters live in the URL, as they do on the equipment list, so every
 * dashboard figure is a plain link to the alerts behind it and the two
 * cannot disagree about what they are counting.
 */
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Siren, X } from "lucide-react";
import {
  ALERT_STATUS_LABELS,
  alertStatusTone,
  api,
  formatDate,
  PRIORITIES,
  PRIORITY_LABELS,
  priorityTone,
  type Alert,
  type AlertStatus,
} from "../lib/api";
import { Badge, Card, Empty, ErrorNote, Pager, Spinner } from "../components/ui";

interface Feed {
  total: number;
  page: number;
  pageSize: number;
  rows: Alert[];
}

const STATUSES: AlertStatus[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CANCELLED",
];

const FILTER_LABELS: Record<string, string> = {
  priority: "Priority",
  status: "Status",
  open: "Showing",
};

function labelFor(key: string, value: string) {
  if (key === "priority") return PRIORITY_LABELS[value as never] ?? value;
  if (key === "status") return ALERT_STATUS_LABELS[value as never] ?? value;
  if (key === "open") return value === "true" ? "Unresolved only" : "All";
  return value;
}

export function Alerts() {
  const [params, setParams] = useSearchParams();

  const page = Number(params.get("page") ?? 1);
  const status = params.get("status") ?? "";
  const priority = params.get("priority") ?? "";
  // Unresolved by default: the queue is a work list, and yesterday's
  // finished jobs are not work.
  const openOnly = (params.get("open") ?? "true") === "true";

  const query = useQuery({
    queryKey: ["alerts", params.toString()],
    queryFn: () => {
      const q = new URLSearchParams({ page: String(page) });
      if (status) q.set("status", status);
      if (priority) q.set("priority", priority);
      // "Unresolved" and an explicit status are mutually exclusive.
      if (openOnly && !status) q.set("open", "true");
      return api.get<Feed>(`/api/alerts?${q}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  /** Changing a filter returns to page 1; the old page rarely exists. */
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };

  // Paging must not go through setFilter, which drops `page` by design.
  const goToPage = (next: number) => {
    const q = new URLSearchParams(params);
    q.set("page", String(next));
    setParams(q);
  };

  const active = [...params.entries()].filter(([k]) => k !== "page" && k !== "pageSize");
  const totalPages = query.data ? Math.ceil(query.data.total / query.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-medium text-slate-900">Alerts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Faults reported from the wards. {query.data ? `${query.data.total} shown.` : ""}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setFilter("priority", e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setFilter("status", e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {ALERT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={openOnly}
            disabled={status !== ""}
            onChange={(e) => setFilter("open", e.target.checked ? "" : "false")}
          />
          Unresolved only
        </label>
      </div>

      {active.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-400">Filtered by</span>
          {active.map(([key, value]) => (
            <button
              key={key}
              onClick={() => setFilter(key, "")}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-teal-200 bg-teal-50 px-2 py-1 text-xs text-teal-900 transition hover:border-teal-400 hover:bg-teal-100"
            >
              <span className="text-teal-600">{FILTER_LABELS[key] ?? key}:</span>
              {labelFor(key, value)}
              <X size={12} />
            </button>
          ))}
          <button
            onClick={() => setParams(new URLSearchParams())}
            className="cursor-pointer text-xs text-slate-500 underline hover:text-slate-800"
          >
            Clear all
          </button>
        </div>
      )}

      <Card className="mt-4">
        {query.isLoading ? (
          <Spinner label="Loading alerts" />
        ) : query.isError ? (
          <ErrorNote message="Could not load alerts." />
        ) : query.data!.rows.length === 0 ? (
          <Empty
            title="No alerts here."
            hint="Faults reported from the wards appear in this list."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data!.rows.map((alert) => (
              <li key={alert.id}>
                <Link
                  to={`/alerts/${alert.id}`}
                  className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                >
                  <Siren
                    size={16}
                    className={`mt-0.5 shrink-0 ${
                      alert.priority === "EMERGENCY" ? "text-rose-500" : "text-slate-300"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={priorityTone(alert.priority)}>
                        {PRIORITY_LABELS[alert.priority]}
                      </Badge>
                      <Badge tone={alertStatusTone(alert.status)}>
                        {ALERT_STATUS_LABELS[alert.status]}
                      </Badge>
                      <span className="font-mono text-xs text-slate-400">{alert.number}</span>
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-800">
                      {alert.equipment.name}{" "}
                      <span className="font-mono text-xs text-slate-400">
                        {alert.equipment.assetNo}
                      </span>
                    </div>
                    <p className="truncate text-sm text-slate-600">{alert.description}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {alert.equipment.department.name} · reported by {alert.raisedBy.fullName} ·{" "}
                      {formatDate(alert.openedAt)}
                      {alert.assignedTo ? ` · with ${alert.assignedTo.fullName}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {query.data && <Pager page={page} totalPages={totalPages} onChange={goToPage} />}
      </Card>
    </div>
  );
}
