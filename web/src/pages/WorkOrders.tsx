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
import { Link, useSearchParams } from "react-router-dom";
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
import { Badge, Card, Empty, ErrorNote, Pager, Spinner } from "../components/ui";

interface Feed {
  total: number;
  page: number;
  pageSize: number;
  rows: WorkOrder[];
}

export function WorkOrders() {
  const [params, setParams] = useSearchParams();

  const page = Number(params.get("page") ?? 1);
  const archived = params.get("archived") === "true";

  const query = useQuery({
    queryKey: ["work-orders", params.toString()],
    queryFn: () =>
      api.get<Feed>(`/api/work-orders?page=${page}&archived=${archived ? "true" : "false"}`),
    placeholderData: keepPreviousData,
  });

  const setTab = (next: boolean) => {
    const q = new URLSearchParams(params);
    q.set("archived", String(next));
    q.delete("page");
    setParams(q);
  };

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

      <Card className="mt-4">
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
          <ul className="divide-y divide-slate-100">
            {query.data!.rows.map((wo) => {
              const outstanding = wo.parts.filter((p) => isPartOutstanding(p.status)).length;
              return (
                <li key={wo.id}>
                  <Link
                    to={`/work-orders/${wo.id}`}
                    className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                  >
                    {wo.status === "CLOSED" ? (
                      <Lock size={15} className="mt-1 shrink-0 text-slate-300" />
                    ) : (
                      <Wrench size={15} className="mt-1 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={priorityTone(wo.priority)}>
                          {PRIORITY_LABELS[wo.priority]}
                        </Badge>
                        <Badge tone={wo.status === "CLOSED" ? "emerald" : "sky"}>
                          {WORK_ORDER_STATUS_LABELS[wo.status]}
                        </Badge>
                        {outstanding > 0 && (
                          <Badge tone="amber">
                            {outstanding} part{outstanding === 1 ? "" : "s"} outstanding
                          </Badge>
                        )}
                        <span className="font-mono text-xs text-slate-400">{wo.number}</span>
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-800">
                        {wo.equipment.name}{" "}
                        <span className="font-mono text-xs text-slate-400">
                          {wo.equipment.assetNo}
                        </span>
                      </div>
                      <p className="truncate text-sm text-slate-600">{wo.alert.description}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {wo.engineer.fullName} · opened {formatDate(wo.createdAt)}
                        {wo.closedAt ? ` · closed ${formatDate(wo.closedAt)}` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {query.data && <Pager page={page} totalPages={totalPages} onChange={goToPage} />}
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
