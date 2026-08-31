import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api, formatDate, type Notification } from "../lib/api";
import { Badge, Card, ErrorNote, Pager, Spinner, type Tone } from "../components/ui";

const LEVEL_TONE: Record<string, Tone> = {
  INFO: "sky",
  WARNING: "amber",
  URGENT: "amber",
  DUE: "amber",
  OVERDUE: "rose",
};

export function Notifications() {
  const qc = useQueryClient();

  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["notifications", page],
    queryFn: () =>
      api.get<{
        total: number;
        pageSize: number;
        rows: Notification[];
        unread: number;
        scope: "all" | "own";
      }>(`/api/notifications?page=${page}`),
    placeholderData: keepPreviousData,
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (query.isLoading) return <Spinner label="Loading notifications" />;
  if (query.isError) return <ErrorNote message="Could not load notifications." />;

  const rows = query.data!.rows;
  const totalPages = Math.ceil(query.data!.total / query.data!.pageSize);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every reminder the scheduler has sent you, newest first.
          </p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={() => markAll.mutate()}
            className="cursor-pointer text-sm text-teal-700 hover:text-teal-900"
          >
            Mark all as read
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <Bell size={20} className="mx-auto text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">No notifications yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Reminders are addressed to the engineer responsible for each device. The scheduler runs
            nightly; an administrator can run it ahead from the bar at the top of the screen.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {rows.map((n) => (
            <li key={n.id}>
              <Card className="p-3">
                <div className="flex items-start gap-3">
                  <Badge tone={LEVEL_TONE[n.level] ?? "slate"}>{n.level.toLowerCase()}</Badge>
                  <div className="min-w-0 flex-1">
                    {n.equipment ? (
                      <Link
                        to={`/equipment/${n.equipment.id}`}
                        className="text-sm text-slate-800 hover:text-teal-800"
                      >
                        {n.equipment.name}{" "}
                        <span className="font-mono text-xs text-slate-400">
                          {n.equipment.assetNo}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-sm text-slate-800">{n.title}</span>
                    )}
                    <p className="text-sm text-slate-600">{n.body}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Sent {formatDate(n.createdAt)}
                      {n.recipient ? ` to ${n.recipient.fullName}` : ""}
                    </p>
                  </div>
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />}
                </div>
              </Card>
            </li>
          ))}
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
