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
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Siren } from "lucide-react";
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
  type Priority,
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

export function Alerts() {
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["alerts", status, priority, openOnly, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);
      // "Open" and an explicit status are mutually exclusive filters.
      if (openOnly && !status) params.set("open", "true");
      return api.get<Feed>(`/api/alerts?${params}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const reset = () => setPage(1);
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
          onChange={(e) => {
            setPriority(e.target.value);
            reset();
          }}
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
          onChange={(e) => {
            setStatus(e.target.value);
            reset();
          }}
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
            onChange={(e) => {
              setOpenOnly(e.target.checked);
              reset();
            }}
          />
          Unresolved only
        </label>
      </div>

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

        {query.data && <Pager page={page} totalPages={totalPages} onChange={setPage} />}
      </Card>
    </div>
  );
}

/** Shared by the list and the device page, so a priority always reads the same. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={priorityTone(priority)}>{PRIORITY_LABELS[priority]}</Badge>;
}
