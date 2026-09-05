/**
 * Work orders, live and archived.
 *
 * The archive is this same list with one filter applied, not a separate
 * screen reading a separate table. Closed work orders stay queryable
 * beside open ones, which is what makes them useful for reporting rather
 * than merely stored.
 *
 * Visibility comes from the alert each work order belongs to, so an
 * engineer sees their own and their department's, and oversight roles see
 * the estate — decided once, on the server.
 */
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock, Wrench } from "lucide-react";
import {
  api,
  formatDate,
  isPartOutstanding,
  PRIORITY_LABELS,
  priorityTone,
  WORK_ORDER_STATUS_LABELS,
  type WorkOrder,
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
  rows: WorkOrder[];
}

export function WorkOrders() {
  const [params, setParams] = useSearchParams();

  const navigate = useNavigate();

  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  const sort = params.get("sort");
  const dir: SortDirection = params.get("dir") === "desc" ? "desc" : "asc";

  const SORT_OPTIONS = [
    { label: "Most urgent first", column: "priority", dir: "asc" as const },
    { label: "Newest first", column: "createdAt", dir: "desc" as const },
    { label: "Oldest first", column: "createdAt", dir: "asc" as const },
    { label: "Engineer", column: "engineer", dir: "asc" as const },
    { label: "Status", column: "status", dir: "asc" as const },
  ];
  const archived = params.get("archived") === "true";

  const query = useQuery({
    queryKey: ["work-orders", params.toString()],
    queryFn: () =>
      api.get<Feed>(`/api/work-orders?${listQuery.toString()}`),
    placeholderData: keepPreviousData,
  });

  const setTab = (next: boolean) => {
    const q = new URLSearchParams(params);
    q.set("archived", String(next));
    q.delete("page");
    setParams(q);
  };

  const listQuery = (() => {
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      archived: archived ? "true" : "false",
    });
    if (sort) {
      q.set("sort", sort);
      q.set("dir", dir);
    }
    return q;
  })();

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

  /** Same tab and order, without the paging. */
  const exportHref = (() => {
    const q = new URLSearchParams(listQuery);
    q.delete("page");
    q.delete("pageSize");
    q.set("format", "csv");
    return `/api/work-orders?${q.toString()}`;
  })();

  const goToPage = (next: number) => {
    const q = new URLSearchParams(params);
    q.set("page", String(next));
    setParams(q);
  };

  const totalPages = query.data ? Math.ceil(query.data.total / query.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-medium text-slate-900">Work orders</h1>
      <p className="mt-1 text-sm text-slate-500">
        {archived
          ? "Completed and closed work, kept for reporting and audit."
          : "Repairs currently under way."}
      </p>

      <div className="mt-4 flex gap-1">
        <Tab active={!archived} onClick={() => setTab(false)}>
          In progress
        </Tab>
        <Tab active={archived} onClick={() => setTab(true)}>
          Archive
        </Tab>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <SortSelect options={SORT_OPTIONS} sort={sort} dir={dir} onSort={setSort} />
        <ExportButton href={exportHref} />
      </div>

      <Card className="mt-3">
        {query.isLoading ? (
          <Spinner label="Loading work orders" />
        ) : query.isError ? (
          <ErrorNote message="Could not load work orders." />
        ) : query.data!.rows.length === 0 ? (
          <Empty
            title={archived ? "Nothing archived yet." : "No work under way."}
            hint={
              archived
                ? "Work orders appear here once they are closed."
                : "A work order is opened when an engineer picks up an assigned alert."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Work order</th>
                  <th className="px-4 py-2.5 font-medium">Equipment</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Department</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Engineer</th>
                  <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Opened</th>
                  <th className="px-4 py-2.5 font-medium">Parts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data!.rows.map((wo) => {
                  const outstanding = wo.parts.filter((p) => isPartOutstanding(p.status)).length;
                  return (
                    <tr
                      key={wo.id}
                      onClick={() => navigate(`/work-orders/${wo.id}`)}
                      className="cursor-pointer transition hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          {wo.status === "CLOSED" ? (
                            <Lock size={13} className="shrink-0 text-slate-300" />
                          ) : (
                            <Wrench size={13} className="shrink-0 text-slate-400" />
                          )}
                          <span className="font-mono text-xs text-slate-600">{wo.number}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-slate-800">{wo.equipment.name}</div>
                        <div className="font-mono text-xs text-slate-400">
                          {wo.equipment.assetNo}
                        </div>
                      </td>
                      <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">
                        {wo.equipment.department.name}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={priorityTone(wo.priority)}>
                          {PRIORITY_LABELS[wo.priority]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={wo.status === "CLOSED" ? "emerald" : "sky"}>
                          {WORK_ORDER_STATUS_LABELS[wo.status]}
                        </Badge>
                      </td>
                      <td className="hidden px-4 py-2.5 text-slate-600 md:table-cell">
                        {wo.engineer.fullName}
                      </td>
                      <td className="hidden px-4 py-2.5 font-mono text-xs text-slate-500 xl:table-cell">
                        {formatDate(wo.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        {/* Only outstanding parts are worth a badge. A count of
                            parts already fitted answers a question nobody asked
                            of a list of live repairs. */}
                        {outstanding > 0 ? (
                          <Badge tone="amber">{outstanding} on order</Badge>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-md px-3 py-1.5 text-sm transition ${
        active
          ? "bg-teal-50 font-medium text-teal-900"
          : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}
