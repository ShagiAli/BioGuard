import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import {
  api,
  formatDate,
  PM_LABELS,
  STATUS_LABELS,
  titleCase,
  type EquipmentRow,
} from "../lib/api";
import { Badge, Card, Empty, ErrorNote, Spinner, pmTone } from "../components/ui";

const PM_OPTIONS = ["OVERDUE", "DUE_30", "DUE_NOW", "DUE_SOON", "SCHEDULED"] as const;
const CRITICALITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const STATUSES = [
  "OPERATIONAL",
  "UNDER_MAINTENANCE",
  "UNDER_REPAIR",
  "AWAITING_PARTS",
  "OUT_OF_SERVICE",
] as const;

const FILTER_LABELS: Record<string, string> = {
  pm: "Maintenance",
  criticality: "Criticality",
  operationalStatus: "Status",
  q: "Search",
};

function labelFor(key: string, value: string) {
  if (key === "pm") return value === "DUE_30" ? "Due within 30 days" : PM_LABELS[value as never];
  if (key === "operationalStatus") return STATUS_LABELS[value as never];
  return titleCase(value);
}

export function Equipment() {
  /**
   * Filters live in the URL. That makes every dashboard drill-down a
   * plain link, makes the back button behave, and makes a filtered view
   * something you can send to a colleague.
   */
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");

  const page = Number(params.get("page") ?? 1);

  /**
   * Debounced, so a query does not fire on every keystroke.
   *
   * `params` must stay in the dependencies. The write lands up to 300ms
   * after the keystroke that scheduled it, and a filter dropdown may
   * have rewritten the URL in between — with a stale snapshot the write
   * restores the old parameters and silently discards the filter the
   * user just picked. Re-running on `params` also keeps `setParams`
   * fresh, since react-router memoises it on the current parameters.
   *
   * This does not loop: once the term is in the URL the guard below
   * finds nothing to change.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (search) next.set("q", search);
      else next.delete("q");
      next.delete("page");
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, params, setParams]);

  const query = useQuery({
    queryKey: ["equipment", params.toString()],
    queryFn: () =>
      api.get<{ total: number; page: number; pageSize: number; rows: EquipmentRow[] }>(
        `/api/equipment?${params.toString()}`
      ),
    placeholderData: keepPreviousData,
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };

  const active = [...params.entries()].filter(([k]) => k !== "page" && k !== "pageSize");
  const totalPages = query.data ? Math.ceil(query.data.total / query.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-xl font-medium text-slate-900">Equipment</h1>
      <p className="mt-1 text-sm text-slate-500">
        {query.data ? `${query.data.total} matching devices.` : "Loading…"}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, asset number, serial or model"
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-500"
          />
        </div>

        <select
          value={params.get("pm") ?? ""}
          onChange={(e) => setFilter("pm", e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">All maintenance states</option>
          {PM_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {labelFor("pm", v)}
            </option>
          ))}
        </select>

        <select
          value={params.get("criticality") ?? ""}
          onChange={(e) => setFilter("criticality", e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">All criticalities</option>
          {CRITICALITIES.map((v) => (
            <option key={v} value={v}>
              {titleCase(v)}
            </option>
          ))}
        </select>

        <select
          value={params.get("operationalStatus") ?? ""}
          onChange={(e) => setFilter("operationalStatus", e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">All statuses</option>
          {STATUSES.map((v) => (
            <option key={v} value={v}>
              {STATUS_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      {active.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-400">Filtered by</span>
          {active.map(([key, value]) => (
            <button
              key={key}
              onClick={() => {
                if (key === "q") setSearch("");
                setFilter(key, "");
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-teal-200 bg-teal-50 px-2 py-1 text-xs text-teal-900 transition hover:border-teal-400 hover:bg-teal-100"
            >
              <span className="text-teal-600">{FILTER_LABELS[key] ?? key}:</span>
              {labelFor(key, value)}
              <X size={12} />
            </button>
          ))}
          <button
            onClick={() => {
              setSearch("");
              setParams(new URLSearchParams());
            }}
            className="cursor-pointer text-xs text-slate-500 underline hover:text-slate-800"
          >
            Clear all
          </button>
        </div>
      )}

      <Card className="mt-4 overflow-hidden">
        {query.isLoading ? (
          <Spinner label="Loading equipment" />
        ) : query.isError ? (
          <ErrorNote message="Could not load the equipment list." />
        ) : query.data!.rows.length === 0 ? (
          <Empty title="No devices match these filters." hint="Clear a filter to widen the search." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Asset</th>
                <th className="px-4 py-2.5 font-medium">Device</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Location</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Engineer</th>
                <th className="px-4 py-2.5 font-medium">Next PM</th>
                <th className="px-4 py-2.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data!.rows.map((d) => (
                <tr key={d.id} className="cursor-pointer transition hover:bg-slate-100">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                    <Link to={`/equipment/${d.id}`} className="block">
                      {d.assetNo}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link to={`/equipment/${d.id}`} className="block">
                      <div className="text-slate-800">{d.name}</div>
                      <div className="text-xs text-slate-400">
                        {d.manufacturer.name} {d.model}
                      </div>
                    </Link>
                  </td>
                  <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">
                    {d.department.name}
                    {d.room && (
                      <div className="text-xs text-slate-400">
                        {d.room.building.name} · Room {d.room.code}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-slate-600 md:table-cell">
                    {d.engineer?.fullName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {formatDate(d.nextDueAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={pmTone(d.pmState)}>{PM_LABELS[d.pmState]}</Badge>
                      {d.operationalStatus !== "OPERATIONAL" && (
                        <Badge tone="amber">{STATUS_LABELS[d.operationalStatus]}</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {query.data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setFilter("page", String(page - 1))}
                className="cursor-pointer rounded border border-slate-200 px-2 py-1 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setFilter("page", String(page + 1))}
                className="cursor-pointer rounded border border-slate-200 px-2 py-1 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
