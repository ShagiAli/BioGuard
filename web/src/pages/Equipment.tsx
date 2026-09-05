import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { SavedViews } from "../components/SavedViews";
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
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  ExportButton,
  Pager,
  SortableHeader,
  Spinner,
  pmTone,
  type SortDirection,
} from "../components/ui";

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

/**
 * Parameters that steer the table rather than narrow it.
 *
 * They live in the URL alongside the filters so a view can be shared
 * whole, but they are not things anyone would think of as "filtered by",
 * and offering to remove them as chips would be nonsense.
 */
const NOT_A_FILTER = new Set(["page", "pageSize", "sort", "dir", "format"]);

export function Equipment() {
  /**
   * Filters live in the URL. That makes every dashboard drill-down a
   * plain link, makes the back button behave, and makes a filtered view
   * something you can send to a colleague.
   */
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [search, setSearch] = useState(urlQ);

  /**
   * The last term this component put in the URL. It tells an external
   * navigation apart from our own debounced write, which is the
   * difference between clearing the box and eating a keystroke.
   */
  const lastWritten = useRef(urlQ);

  // Mirrors the roles the API accepts a write from, so the button is
  // not offered to someone the server will refuse.
  const { user } = useAuth();
  const navigate = useNavigate();
  const canRegister = user?.role === "ADMIN" || user?.role === "MANAGER";

  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  const sort = params.get("sort");
  const dir: SortDirection = params.get("dir") === "desc" ? "desc" : "asc";

  /**
   * The URL is the source of truth, so the box has to follow it when it
   * changes underneath us. The sidebar's Equipment link, the back button
   * and a dashboard drill-down all land on this route without
   * unmounting, leaving `search` holding a term the URL no longer has —
   * and the debounce below would write that stale term straight back, so
   * the link looked like it did nothing.
   *
   * Only external changes count. Our own write moves `urlQ` too, and
   * echoing that back would clobber whatever was typed in the moment
   * between the timeout firing and the URL committing.
   */
  useEffect(() => {
    if (urlQ === lastWritten.current) return;
    lastWritten.current = urlQ;
    setSearch(urlQ);
  }, [urlQ]);

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
      // Only act when the typed term differs from the one in the URL.
      // The effect re-runs on every params change (it must, or it writes
      // a stale snapshot), and it resets to page 1 because a new search
      // invalidates the old page number. Without this guard those two
      // facts combine badly: paging to 2 re-runs the effect, which then
      // strips `page` right back off again.
      const current = params.get("q") ?? "";
      if (search === current) return;

      const next = new URLSearchParams(params);
      if (search) next.set("q", search);
      else next.delete("q");
      next.delete("page");
      lastWritten.current = search;
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, params, setParams]);

  const query = useQuery({
    queryKey: ["equipment", params.toString()],
    queryFn: () =>
      api.get<{ total: number; page: number; pageSize: number; rows: EquipmentRow[] }>(
        `/api/equipment?${listParams.toString()}`
      ),
    placeholderData: keepPreviousData,
  });

  /**
   * Changing a filter always returns to the first page, since the old
   * page number rarely exists in the narrowed result set.
   *
   * Which is exactly why paging must not go through here: `setFilter`
   * drops `page` unconditionally, so routing the pager through it set
   * the page and then deleted it in the same breath. The Next button
   * silently did nothing.
   */
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };

  /**
   * The parameters the list is actually built from.
   *
   * `pageSize` is defaulted here rather than left to the API so the
   * export link below asks for exactly what the table is showing.
   */
  const listParams = (() => {
    const next = new URLSearchParams(params);
    if (!next.get("pageSize")) next.set("pageSize", String(pageSize));
    return next;
  })();

  /** Sorting resets to the first page: row 400 of the old order means nothing in the new one. */
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

  /** Same filters and order as the table, minus the paging — an export is the whole filtered set. */
  const exportHref = (() => {
    const next = new URLSearchParams(listParams);
    next.delete("page");
    next.delete("pageSize");
    next.set("format", "csv");
    return `/api/equipment?${next.toString()}`;
  })();

  const goToPage = (next: number) => {
    const params2 = new URLSearchParams(params);
    params2.set("page", String(next));
    setParams(params2);
  };

  const active = [...params.entries()].filter(([k]) => !NOT_A_FILTER.has(k));
  const totalPages = query.data ? Math.ceil(query.data.total / query.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-medium text-slate-900">Equipment</h1>
        {canRegister && (
          <Link
            to="/equipment/new"
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
          >
            Add equipment
          </Link>
        )}
      </div>
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

        <SavedViews
          resource="equipment"
          currentQuery={params.toString()}
          onApply={(query) => setParams(new URLSearchParams(query))}
        />

        <ExportButton href={exportHref} />
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
                <SortableHeader label="Name" column="name" sort={sort} dir={dir} onSort={setSort} />
                <SortableHeader
                  label="Asset no."
                  column="assetNo"
                  sort={sort}
                  dir={dir}
                  onSort={setSort}
                />
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Department</th>
                <SortableHeader
                  label="Status"
                  column="operationalStatus"
                  sort={sort}
                  dir={dir}
                  onSort={setSort}
                />
                <th className="px-4 py-2.5 font-medium">PM status</th>
                <SortableHeader
                  label="Next due"
                  column="nextDueAt"
                  sort={sort}
                  dir={dir}
                  onSort={setSort}
                />
                <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data!.rows.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => navigate(`/equipment/${d.id}`)}
                  className="cursor-pointer transition hover:bg-slate-50"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-brand-800">{d.name}</div>
                    <div className="text-xs text-slate-400">
                      {d.manufacturer.name} {d.model}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{d.assetNo}</td>
                  <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">
                    {d.department.name}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={d.operationalStatus === "OPERATIONAL" ? "emerald" : "amber"}>
                      {STATUS_LABELS[d.operationalStatus]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {/* Kept separate from the column beside it. A device can be
                        under repair and overdue at once, and collapsing the two
                        into one badge hides whichever the reader needed. */}
                    <Badge tone={pmTone(d.pmState)}>{PM_LABELS[d.pmState]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {formatDate(d.nextDueAt)}
                  </td>
                  <td className="hidden px-4 py-2.5 text-slate-600 xl:table-cell">
                    {d.room ? (
                      <>
                        <div>{d.room.building.name}</div>
                        <div className="text-xs text-slate-400">Room {d.room.code}</div>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
