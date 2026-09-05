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
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
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
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  ExportButton,
  Pager,
  SortSelect,
  Spinner,
  type SortDirection,
} from "../components/ui";

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

/**
 * Parameters that steer the table rather than narrow it.
 *
 * They live in the URL alongside the filters so a view can be shared
 * whole, but they are not things anyone would think of as "filtered by",
 * and offering to remove them as chips would be nonsense.
 */
const NOT_A_FILTER = new Set(["page", "pageSize", "sort", "dir", "format"]);

export function Alerts() {
  const [params, setParams] = useSearchParams();

  const navigate = useNavigate();
  const { user } = useAuth();
  const mine = params.get("mine") === "true";

  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  const sort = params.get("sort");
  const dir: SortDirection = params.get("dir") === "desc" ? "desc" : "asc";

  /**
   * Priority is declared most-urgent-first in the schema, so ascending
   * puts emergencies at the top. The labels say what each option does
   * rather than which way the enum runs.
   */
  const SORT_OPTIONS = [
    { label: "Most urgent first", column: "priority", dir: "asc" as const },
    { label: "Least urgent first", column: "priority", dir: "desc" as const },
    { label: "Newest first", column: "openedAt", dir: "desc" as const },
    { label: "Oldest first", column: "openedAt", dir: "asc" as const },
    { label: "Status", column: "status", dir: "asc" as const },
  ];
  const status = params.get("status") ?? "";
  const priority = params.get("priority") ?? "";
  // Unresolved by default: the queue is a work list, and yesterday's
  // finished jobs are not work.
  const openOnly = (params.get("open") ?? "true") === "true";

  const query = useQuery({
    queryKey: ["alerts", params.toString()],
    queryFn: () => {
      const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (sort) {
        q.set("sort", sort);
        q.set("dir", dir);
      }
      if (status) q.set("status", status);
      if (priority) q.set("priority", priority);
      // "Unresolved" and an explicit status are mutually exclusive.
      if (openOnly && !status) q.set("open", "true");
      if (mine) q.set("mine", "true");
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
  /** Sorting resets to page one: row 40 of the old order means nothing in the new one. */
  const setSort = (column: string, nextDir: SortDirection) => {
    const next = new URLSearchParams(params);
    next.set("sort", column);
    next.set("dir", nextDir);
    next.delete("page");
    setParams(next);
  };

  const setPageSize = (size: number) => {
    const next = new URLSearchParams(params);
    next.set("pageSize", String(size));
    next.delete("page");
    setParams(next);
  };

  /** The filters and order the list is showing, without the paging. */
  const exportHref = (() => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (priority) q.set("priority", priority);
    if (openOnly && !status) q.set("open", "true");
    if (mine) q.set("mine", "true");
    if (sort) {
      q.set("sort", sort);
      q.set("dir", dir);
    }
    q.set("format", "csv");
    return `/api/alerts?${q.toString()}`;
  })();

  const goToPage = (next: number) => {
    const q = new URLSearchParams(params);
    q.set("page", String(next));
    setParams(q);
  };

  const active = [...params.entries()].filter(([k]) => !NOT_A_FILTER.has(k));
  const totalPages = query.data ? Math.ceil(query.data.total / query.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-medium text-slate-900">Alerts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Faults reported from the wards. {query.data ? `${query.data.total} shown.` : ""}
      </p>

      {/* Only offered to somebody alerts can be assigned to. For anyone
          else the tab would always be empty, which is not a view. */}
      {(user?.role === "ENGINEER" || user?.role === "ADMIN") && (
        <div className="mt-4 flex items-center gap-1 border-b border-slate-200">
          {[
            { label: "All alerts", value: false },
            { label: "My alerts", value: true },
          ].map((tab) => (
            <button
              key={tab.label}
              onClick={() => {
                const next = new URLSearchParams(params);
                if (tab.value) next.set("mine", "true");
                else next.delete("mine");
                next.delete("page");
                setParams(next);
              }}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-sm transition ${
                mine === tab.value
                  ? "border-brand-600 font-medium text-brand-800"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <SortSelect options={SORT_OPTIONS} sort={sort} dir={dir} onSort={setSort} />
        <ExportButton href={exportHref} />
      </div>

      <Card className="mt-3">
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Alert</th>
                  <th className="px-4 py-2.5 font-medium">Problem</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Equipment</th>
                  <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Reported</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Assigned to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data!.rows.map((alert) => (
                  <tr
                    key={alert.id}
                    onClick={() => navigate(`/alerts/${alert.id}`)}
                    className="cursor-pointer transition hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <Siren
                          size={14}
                          className={
                            alert.priority === "EMERGENCY" ? "text-rose-500" : "text-slate-300"
                          }
                        />
                        <Badge tone={priorityTone(alert.priority)}>
                          {PRIORITY_LABELS[alert.priority]}
                        </Badge>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{alert.number}</td>
                    <td className="max-w-xs px-4 py-2.5">
                      <div className="truncate text-slate-800">{alert.description}</div>
                      <div className="text-xs text-slate-400 lg:hidden">
                        {alert.equipment.name}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 lg:table-cell">
                      <div className="text-slate-700">{alert.equipment.name}</div>
                      <div className="font-mono text-xs text-slate-400">
                        {alert.equipment.assetNo} · {alert.equipment.department.name}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 xl:table-cell">
                      <div className="font-mono text-xs text-slate-600">
                        {formatDate(alert.openedAt)}
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        {alert.raisedBy.fullName}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={alertStatusTone(alert.status)}>
                          {ALERT_STATUS_LABELS[alert.status]}
                        </Badge>
                        {/* The response window, where it has already been missed.
                            Silent otherwise: a badge on every row is one nobody reads. */}
                        {alert.sla.breached && !alert.sla.respondedAt && (
                          <span className="font-mono text-[0.65rem] text-rose-600">
                            past response target
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-600 md:table-cell">
                      {alert.assignedTo?.fullName ?? <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {query.data && (
          <Pager
            page={page}
            totalPages={totalPages}
            onChange={goToPage}
            total={query.data.total}
            pageSize={query.data.pageSize}
            onPageSize={setPageSize}
          />
        )}
      </Card>
    </div>
  );
}
