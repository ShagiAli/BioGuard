/**
 * Reminders, as a list somebody scans rather than reads.
 *
 * The tabs are not a stored category. A notification carries either a
 * device or an alert, and that is already the distinction: the
 * preventive programme reminding you a service is due, or somebody
 * reporting that a device has broken. The design shows two further tabs
 * — work orders and system — and neither exists as a kind of
 * notification, so neither is offered.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Check } from "lucide-react";
import { api, formatDateTime, type Notification } from "../lib/api";
import { Badge, Card, Empty, ErrorNote, Pager, Spinner, type Tone } from "../components/ui";

const LEVEL_TONE: Record<string, Tone> = {
  INFO: "sky",
  WARNING: "amber",
  URGENT: "amber",
  DUE: "amber",
  OVERDUE: "rose",
};

type Kind = "" | "preventive" | "alert";

const TABS: { key: Kind; label: string }[] = [
  { key: "", label: "All" },
  { key: "preventive", label: "Preventive" },
  { key: "alert", label: "Alerts" },
];

export function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [kind, setKind] = useState<Kind>("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const listQuery = (() => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (kind) q.set("kind", kind);
    if (unreadOnly) q.set("unread", "true");
    return q;
  })();

  const query = useQuery({
    queryKey: ["notifications", page, pageSize, kind, unreadOnly],
    queryFn: () =>
      api.get<{
        total: number;
        pageSize: number;
        rows: Notification[];
        unread: number;
        scope: "all" | "own";
      }>(`/api/notifications?${listQuery.toString()}`),
    placeholderData: keepPreviousData,
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  /** Any change to what is being asked for restarts at page one. */
  const reset = <T,>(set: (v: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  if (query.isLoading) return <Spinner label="Loading notifications" />;
  if (query.isError) return <ErrorNote message="Could not load notifications." />;

  const data = query.data!;
  const totalPages = Math.ceil(data.total / data.pageSize);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.scope === "all"
              ? "Every reminder sent across the estate, newest first."
              : "Every reminder sent to you, newest first."}
          </p>
        </div>
        {data.unread > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
          >
            <Check size={15} /> Mark all as read
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key || "all"}
              onClick={() => reset(setKind)(tab.key)}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-sm transition ${
                kind === tab.key
                  ? "border-brand-600 font-medium text-brand-800"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => reset(setUnreadOnly)(e.target.checked)}
            className="cursor-pointer accent-brand-600"
          />
          Unread only
          {data.unread > 0 && <span className="font-mono text-xs text-slate-400">{data.unread}</span>}
        </label>
      </div>

      <Card className="mt-4">
        {data.rows.length === 0 ? (
          <Empty
            title="Nothing here."
            hint={
              unreadOnly
                ? "Everything in this view has been read."
                : "Reminders appear here as the scheduler sends them."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Level</th>
                  <th className="px-4 py-2.5 font-medium">Reminder</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">About</th>
                  <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Recipient</th>
                  <th className="px-4 py-2.5 font-medium">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((n) => {
                  const to = n.equipment ? `/equipment/${n.equipment.id}` : null;
                  return (
                    <tr
                      key={n.id}
                      onClick={() => to && navigate(to)}
                      className={`transition ${to ? "cursor-pointer hover:bg-slate-50" : ""} ${
                        n.readAt ? "" : "bg-brand-50/40"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          {/* Unread is a dot rather than bold text: the row
                              already carries a tint, and two signals for one
                              fact is one too many. */}
                          {!n.readAt && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"
                              aria-label="Unread"
                            />
                          )}
                          <Badge tone={LEVEL_TONE[n.level] ?? "slate"}>
                            {n.level.toLowerCase()}
                          </Badge>
                        </span>
                      </td>
                      <td className="max-w-md px-4 py-2.5">
                        <div className="flex items-center gap-1.5 text-slate-800">
                          {n.alertId ? (
                            <AlertTriangle size={13} className="shrink-0 text-rose-400" />
                          ) : (
                            <CalendarClock size={13} className="shrink-0 text-slate-400" />
                          )}
                          {n.title}
                        </div>
                        <div className="truncate text-xs text-slate-500">{n.body}</div>
                      </td>
                      <td className="hidden px-4 py-2.5 lg:table-cell">
                        {n.equipment ? (
                          <>
                            <div className="text-slate-700">{n.equipment.name}</div>
                            <div className="font-mono text-xs text-slate-400">
                              {n.equipment.assetNo}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-2.5 text-slate-600 xl:table-cell">
                        {n.recipient?.fullName ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                        {formatDateTime(n.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pager
          page={page}
          totalPages={totalPages}
          onChange={setPage}
          total={data.total}
          pageSize={data.pageSize}
          onPageSize={reset(setPageSize)}
        />
      </Card>
    </div>
  );
}
