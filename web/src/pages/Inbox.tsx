import { useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Mail, Trash2 } from "lucide-react";
import { api, formatDate } from "../lib/api";
import { Card, ErrorNote, Pager, Spinner } from "../components/ui";

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

  const query = useQuery({
    queryKey: ["mail", page],
    queryFn: () =>
      api.get<{
        total: number;
        pageSize: number;
        rows: SentEmail[];
        unread: number;
        scope: "all" | "own";
      }>(`/api/mail?page=${page}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["mail"] });

  const markAll = useMutation({
    mutationFn: () => api.post("/api/mail/read-all"),
    onSuccess: refresh,
  });

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

  const { rows, scope } = query.data!;
  const totalPages = Math.ceil(query.data!.total / query.data!.pageSize);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-slate-900">Mail</h1>
          <p className="mt-1 text-sm text-slate-500">
            {scope === "all"
              ? "Every message the scheduler has sent, and who received it."
              : "Messages the scheduler has sent to you."}
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => markAll.mutate()}
              className="cursor-pointer whitespace-nowrap text-sm text-teal-700 hover:text-teal-900"
            >
              Mark all as read
            </button>
            {rows.some((r) => r.readAt) && (
              <button
                onClick={() => clearRead.mutate()}
                disabled={clearRead.isPending}
                className="cursor-pointer whitespace-nowrap text-sm text-slate-500 hover:text-rose-700 disabled:opacity-50"
              >
                Delete read
              </button>
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <Mail size={20} className="mx-auto text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">No mail yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Maintenance reminders arrive here. An administrator can run the scheduler ahead from the
            bar at the top of the screen.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {rows.map((m) => {
            const expanded = open === m.id;
            return (
              <li key={m.id}>
                <Card>
                  <button
                    onClick={() => setOpen(expanded ? null : m.id)}
                    className="flex w-full cursor-pointer items-start gap-3 p-3 text-left transition hover:bg-slate-50"
                  >
                    {expanded ? (
                      <ChevronDown size={15} className="mt-1 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight size={15} className="mt-1 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${m.readAt ? "text-slate-700" : "font-medium text-slate-900"}`}>
                        {m.subject}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                        to {m.to} · {formatDate(m.sentAt)}
                      </div>
                    </div>
                    {!m.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />}
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                      {/* The message exactly as it was delivered. */}
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
                        {m.body}
                      </pre>
                      <div className="mt-3 flex justify-end border-t border-slate-200 pt-3">
                        <button
                          onClick={() => remove.mutate(m.id)}
                          disabled={remove.isPending}
                          className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 hover:text-rose-700 disabled:opacity-50"
                        >
                          <Trash2 size={13} /> Delete this message
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <Card className="mt-2">
          <Pager page={page} totalPages={totalPages} onChange={setPage} />
        </Card>
      )}
    </div>
  );
}
