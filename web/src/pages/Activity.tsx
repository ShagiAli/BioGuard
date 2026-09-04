/**
 * The estate-wide change feed.
 *
 * Every status change and every maintenance record has been written to
 * the audit table since the first release; this is the first thing that
 * reads it. Restricted to the oversight roles, matching the split the
 * API applies.
 *
 * The action filter is what makes this a report rather than a log:
 * filtering to "Schedule re-based" answers the question the scheduling
 * design cares about — where is the programme slipping — because a
 * re-base is recorded precisely when work landed outside the grace
 * window.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { History } from "lucide-react";
import {
  api,
  auditChanges,
  AUDIT_ACTION_LABELS,
  formatDate,
  type AuditEntry,
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
  rows: AuditEntry[];
}

export function Activity() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<SortDirection>("desc");

  const SORT_OPTIONS = [
    { label: "Newest first", column: "createdAt", dir: "desc" as const },
    { label: "Oldest first", column: "createdAt", dir: "asc" as const },
    { label: "Event type", column: "action", dir: "asc" as const },
    { label: "Who", column: "actor", dir: "asc" as const },
  ];

  const listQuery = (() => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (action) q.set("action", action);
    if (sort) {
      q.set("sort", sort);
      q.set("dir", dir);
    }
    return q;
  })();

  /** The same filter and order as the feed, without the paging. */
  const exportHref = (() => {
    const q = new URLSearchParams(listQuery);
    q.delete("page");
    q.delete("pageSize");
    q.set("format", "csv");
    return `/api/audit?${q.toString()}`;
  })();

  /** Sorting or resizing restarts at page one: the old number describes a different list. */
  const onSort = (column: string, nextDir: SortDirection) => {
    setSort(column);
    setDir(nextDir);
    setPage(1);
  };

  const onPageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const actions = useQuery({
    queryKey: ["audit-actions"],
    queryFn: () => api.get<{ actions: string[] }>("/api/audit/actions"),
  });

  const query = useQuery({
    queryKey: ["audit", action, page, pageSize, sort, dir],
    queryFn: () => api.get<Feed>(`/api/audit?${listQuery.toString()}`),
    placeholderData: keepPreviousData,
  });

  const totalPages = query.data ? Math.ceil(query.data.total / query.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-medium text-slate-900">Activity</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every recorded change, newest first. {query.data ? `${query.data.total} entries.` : ""}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">All activity</option>
          {actions.data?.actions.map((a) => (
            <option key={a} value={a}>
              {AUDIT_ACTION_LABELS[a] ?? a}
            </option>
          ))}
        </select>

        <SortSelect options={SORT_OPTIONS} sort={sort} dir={dir} onSort={onSort} />

        <div className="ml-auto">
          <ExportButton href={exportHref} />
        </div>
      </div>

      <Card className="mt-4">
        {query.isLoading ? (
          <Spinner label="Loading activity" />
        ) : query.isError ? (
          <ErrorNote message="Could not load the activity feed." />
        ) : query.data!.rows.length === 0 ? (
          <Empty
            title="Nothing recorded yet."
            hint="Changing a device's status or filing maintenance will appear here."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data!.rows.map((entry) => (
              <li key={entry.id} className="px-4 py-3">
                <AuditRow entry={entry} />
              </li>
            ))}
          </ul>
        )}

        {query.data && (
          <Pager
            page={page}
            totalPages={totalPages}
            onChange={setPage}
            total={query.data.total}
            pageSize={query.data.pageSize}
            onPageSize={onPageSize}
          />
        )}
      </Card>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const rebased = entry.action === "maintenance.recorded_rebased";

  return (
    <div className="flex items-start gap-3">
      <History size={15} className="mt-1 shrink-0 text-slate-300" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={rebased ? "amber" : "slate"}>
            {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
          </Badge>
          {entry.equipment && (
            <Link
              to={`/equipment/${entry.equipment.id}`}
              className="truncate text-sm text-slate-800 hover:text-teal-800"
            >
              {entry.equipment.name}{" "}
              <span className="font-mono text-xs text-slate-400">{entry.equipment.assetNo}</span>
            </Link>
          )}
        </div>

        <AuditDiff entry={entry} />

        <p className="mt-1 text-xs text-slate-400">
          {formatDate(entry.createdAt)}
          {entry.actor ? ` · ${entry.actor.fullName}` : " · system"}
        </p>
      </div>
    </div>
  );
}

/** The fields that actually moved, rendered old → new. */
export function AuditDiff({ entry }: { entry: AuditEntry }) {
  const changes = auditChanges(entry);
  if (changes.length === 0) {
    return <p className="mt-1 text-sm text-slate-500">No field changes recorded.</p>;
  }

  return (
    <ul className="mt-1 space-y-0.5">
      {changes.map((change) => (
        <li key={change.field} className="text-sm text-slate-600">
          <span className="text-slate-500">{change.label}:</span>{" "}
          <span className="text-slate-400">{change.from}</span>
          <span className="mx-1 text-slate-300">→</span>
          <span className="font-medium text-slate-800">{change.to}</span>
        </li>
      ))}
    </ul>
  );
}
