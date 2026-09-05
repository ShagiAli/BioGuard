/**
 * Mail, as delivered.
 *
 * This is a delivery log rather than a mailbox: the application sends,
 * nobody replies, and nothing moves. The design draws a folder rail —
 * Inbox, Sent, Starred, Archive, Trash — and four of those five would
 * show the same rows as the first, so the rail here carries the two
 * views that are real. A folder that is a synonym for another folder is
 * worse than no folder.
 *
 * Messages open in place. A reading pane beside the list would be the
 * usual shape, and it is the wrong one for a body that is four lines of
 * reminder text.
 */
import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Inbox as InboxIcon, MailOpen, Trash2 } from "lucide-react";
import { api, formatDateTime } from "../lib/api";
import { Badge, Card, ErrorNote, Pager, Spinner } from "../components/ui";

interface SentEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  readAt: string | null;
}

export function Inbox() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const listQuery = (() => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (unreadOnly) q.set("unread", "true");
    return q;
  })();

  const query = useQuery({
    queryKey: ["mail", page, pageSize, unreadOnly],
    queryFn: () =>
      api.get<{
        total: number;
        pageSize: number;
        rows: SentEmail[];
        unread: number;
        scope: "all" | "own";
      }>(`/api/mail?${listQuery.toString()}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["mail"] });

  const markAll = useMutation({ mutationFn: () => api.post("/api/mail/read-all"), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/mail/${id}`),
    onSuccess: refresh,
  });
  const clearRead = useMutation({
    mutationFn: () => api.del<{ deleted: number }>("/api/mail/read"),
    onSuccess: refresh,
  });

  if (query.isLoading) return <Spinner label="Loading mail" />;
  if (query.isError) return <ErrorNote message="Could not load the mailbox." />;

  const data = query.data!;
  const totalPages = Math.ceil(data.total / data.pageSize);

  const view = (only: boolean) => {
    setUnreadOnly(only);
    setPage(1);
    setOpen(null);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Mail</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.scope === "all"
              ? "Every message the scheduler has sent, and who received it."
              : "Messages the scheduler has sent to you."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {data.unread > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
            >
              <MailOpen size={15} /> Mark all as read
            </button>
          )}
          <button
            onClick={() => clearRead.mutate()}
            disabled={clearRead.isPending}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-rose-700 disabled:opacity-50"
          >
            <Trash2 size={15} /> Delete read
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[13rem_1fr]">
        <aside>
          <nav className="space-y-1">
            <RailItem
              label="All mail"
              icon={InboxIcon}
              count={data.scope === "all" || !unreadOnly ? data.total : undefined}
              active={!unreadOnly}
              onClick={() => view(false)}
            />
            <RailItem
              label="Unread"
              icon={MailOpen}
              count={data.unread}
              active={unreadOnly}
              onClick={() => view(true)}
            />
          </nav>
          <p className="mt-4 px-3 text-xs leading-relaxed text-slate-400">
            Nothing is sent outside the application. Every reminder is stored here so the schedule
            can be read end to end.
          </p>
        </aside>

        <Card>
          {data.rows.length === 0 ? (
            <div className="p-10 text-center">
              <InboxIcon size={20} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm text-slate-600">
                {unreadOnly ? "Nothing unread." : "No mail yet."}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Maintenance reminders arrive here. An administrator can run the scheduler ahead from
                the bar at the top of the screen.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-8 px-4 py-2.5 font-medium" />
                    <th className="px-4 py-2.5 font-medium">Subject</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">To</th>
                    <th className="px-4 py-2.5 font-medium">Sent</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((m) => {
                    const expanded = open === m.id;
                    return (
                      <Fragment key={m.id}>
                        <tr
                          onClick={() => setOpen(expanded ? null : m.id)}
                          className={`cursor-pointer transition hover:bg-slate-50 ${
                            m.readAt ? "" : "bg-brand-50/40"
                          }`}
                        >
                          <td className="px-4 py-2.5 text-slate-400">
                            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          </td>
                          <td className="max-w-md px-4 py-2.5">
                            <div
                              className={`truncate ${
                                m.readAt ? "text-slate-700" : "font-medium text-slate-900"
                              }`}
                            >
                              {m.subject}
                            </div>
                          </td>
                          <td className="hidden px-4 py-2.5 font-mono text-xs text-slate-500 md:table-cell">
                            {m.to}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                            {formatDateTime(m.sentAt)}
                          </td>
                          <td className="px-4 py-2.5">
                            {m.readAt ? (
                              <Badge tone="slate">Read</Badge>
                            ) : (
                              <Badge tone="teal">Unread</Badge>
                            )}
                          </td>
                        </tr>

                        {expanded && (
                          <tr className="bg-slate-50">
                            <td />
                            <td colSpan={4} className="px-4 py-3">
                              {/* The message exactly as it was delivered. */}
                              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
                                {m.body}
                              </pre>
                              <div className="mt-3 flex justify-end border-t border-slate-200 pt-3">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    remove.mutate(m.id);
                                  }}
                                  disabled={remove.isPending}
                                  className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 transition hover:text-rose-700 disabled:opacity-50"
                                >
                                  <Trash2 size={13} /> Delete this message
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </Card>
      </div>
    </div>
  );
}

function RailItem({
  label,
  icon: Icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: typeof InboxIcon;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
        active ? "bg-brand-50 font-medium text-brand-900" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <Icon size={15} className={active ? "text-brand-700" : "text-slate-400"} />
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="font-mono text-xs text-slate-400">{count}</span>
      )}
    </button>
  );
}
