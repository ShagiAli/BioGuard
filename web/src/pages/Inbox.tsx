import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Mail } from "lucide-react";
import { api, formatDate } from "../lib/api";
import { Card, ErrorNote, Spinner } from "../components/ui";

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

  const query = useQuery({
    queryKey: ["mail"],
    queryFn: () =>
      api.get<{ rows: SentEmail[]; unread: number; scope: "all" | "own" }>("/api/mail"),
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/api/mail/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail"] }),
  });

  if (query.isLoading) return <Spinner label="Loading mail" />;
  if (query.isError) return <ErrorNote message="Could not load the mailbox." />;

  const { rows, scope } = query.data!;

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
          <button
            onClick={() => markAll.mutate()}
            className="cursor-pointer whitespace-nowrap text-sm text-teal-700 hover:text-teal-900"
          >
            Mark all as read
          </button>
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
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
