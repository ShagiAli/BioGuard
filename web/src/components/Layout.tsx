import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  Boxes,
  Clock,
  History,
  Siren,
  LayoutDashboard,
  LogOut,
  Mail,
  RotateCcw,
} from "lucide-react";
import {
  api,
  formatDate,
  titleCase,
  type AlertSummary,
  type SchedulerHealth,
} from "../lib/api";
import { useAuth } from "../auth";

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // Only the unread counts are needed here, and those are counted over
  // the whole mailbox rather than the page — so ask for the smallest
  // page the API allows instead of pulling rows the sidebar never draws.
  const { data } = useQuery({
    queryKey: ["notifications", "badge"],
    queryFn: () => api.get<{ unread: number }>("/api/notifications?pageSize=1"),
    refetchInterval: 60_000,
  });

  const mail = useQuery({
    queryKey: ["mail", "badge"],
    queryFn: () => api.get<{ unread: number }>("/api/mail?pageSize=1"),
    refetchInterval: 60_000,
  });

  // Counts unresolved alerts within whatever this role can see.
  const alerts = useQuery({
    queryKey: ["alerts", "badge"],
    queryFn: () => api.get<AlertSummary>("/api/alerts/summary"),
    refetchInterval: 60_000,
  });

  // Same split the API applies: oversight roles see the whole programme
  // rather than their own workload.
  const oversees = user?.role === "ADMIN" || user?.role === "MANAGER";

  const nav = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/equipment", label: "Equipment", icon: Boxes, end: false },
    { to: "/notifications", label: "Notifications", icon: Bell, end: false, count: data?.unread },
    { to: "/mail", label: "Mail", icon: Mail, end: false, count: mail.data?.unread },
    // Unlike Activity, this is not gated: every role has a stake in
    // alerts, and the API decides which ones each of them can see.
    { to: "/alerts", label: "Alerts", icon: Siren, end: false, count: alerts.data?.open },
    ...(oversees
      ? [{ to: "/activity", label: "Activity", icon: History, end: false, count: undefined }]
      : []),
  ];

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-5">
          <div className="font-mono text-lg font-semibold tracking-tight text-teal-800">
            BioGuard
          </div>
          <div className="mt-1 text-xs leading-snug text-slate-500">
            Northfield Teaching Hospital
          </div>
        </div>

        <nav className="flex-1 p-3">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                    isActive
                      ? "bg-teal-50 font-medium text-teal-900"
                      : "text-slate-600 hover:bg-slate-50"
                  }`
                }
              >
                <Icon size={16} />
                <span className="flex-1">{item.label}</span>
                {item.count ? (
                  <span className="rounded-full bg-rose-600 px-1.5 py-0.5 font-mono text-xs text-white">
                    {item.count}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="px-1 text-sm text-slate-700">{user?.fullName}</div>
          <div className="px-1 text-xs text-slate-400">{titleCase(user?.role ?? "")}</div>
          <button
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
            className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {oversees && <SchedulerWarning />}
        {user?.role === "ADMIN" && <SimulateBar />}
        <main className="flex-1 overflow-auto p-5">{children}</main>
      </div>
    </div>
  );
}

/**
 * A maintenance reminder system does its work once a month at 02:00,
 * which makes it nearly impossible to show. This replays the real
 * scheduler forward over future dates against real data, so what lands
 * in the inbox is exactly what would have been sent.
 */
function SimulateBar() {
  const qc = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["equipment"] });
    qc.invalidateQueries({ queryKey: ["attention"] });
    // The sweep writes mail as well as notifications. Without this the
    // Mail page only catches up on its 60-second poll, which reads as
    // the app being slow.
    qc.invalidateQueries({ queryKey: ["mail"] });
  };

  const simulate = useMutation({
    mutationFn: (days: number) =>
      api.post<{ notificationsSent: number; through: string }>("/api/admin/simulate", { days }),
    onSuccess: (data) => {
      setResult(
        data.notificationsSent === 0
          ? `No new reminders were due through ${data.through}. Every rung in that range has already been sent — press Reset to replay it.`
          : `${data.notificationsSent} reminder${
              data.notificationsSent === 1 ? "" : "s"
            } sent, through ${data.through}. Read them under Notifications, or Mail to see the messages as delivered.`
      );
      refresh();
    },
    // Without this, a failed request renders nothing at all and the
    // button looks broken.
    onError: (err) => {
      setResult(null);
      setError(err instanceof Error ? err.message : "The sweep could not be run.");
    },
  });

  const reset = useMutation({
    mutationFn: () => api.post<{ cleared: number }>("/api/admin/reset-dispatches"),
    onSuccess: (data) => {
      setResult(`Cleared ${data.cleared} dispatch records. The same dates can now be replayed.`);
      refresh();
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof Error ? err.message : "Could not clear the dispatch history.");
    },
  });

  const busy = simulate.isPending || reset.isPending;

  return (
    <header className="border-b border-slate-200 bg-white px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-dashed border-teal-400 bg-teal-50 px-3 py-1.5">
          <Clock size={15} className="text-teal-700" />
          <div>
            <div className="text-xs uppercase tracking-wide text-teal-700">Run scheduler ahead</div>
            <div className="font-mono text-sm font-medium text-teal-900">Reminder engine</div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {[7, 14, 30, 90].map((n) => (
            <button
              key={n}
              disabled={busy}
              onClick={() => simulate.mutate(n)}
              className="cursor-pointer rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-600 transition hover:border-teal-400 hover:bg-slate-100 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              +{n}d
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => reset.mutate()}
            className="ml-1 flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>

        {busy && (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
            Running the sweep, one day at a time…
          </span>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}
      {result && !error && (
        <div className="mt-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {result}
        </div>
      )}
    </header>
  );
}

/**
 * Warns when the reminder engine has gone quiet.
 *
 * The failure this exists for is specific and silent: the scheduler
 * dies, the API keeps serving, engineers keep filing work, and reminders
 * simply stop. Nothing else in the product would show it — the worst
 * outcome for a system people have started trusting.
 *
 * Renders nothing while healthy. A banner that is always there is one
 * nobody reads.
 */
function SchedulerWarning() {
  const { data } = useQuery({
    queryKey: ["scheduler"],
    queryFn: () => api.get<SchedulerHealth>("/api/admin/scheduler"),
    refetchInterval: 60_000,
  });

  if (!data) return null;
  const broken = !data.running;
  const stale = data.freshness === "stale";
  if (!broken && !stale) return null;

  return (
    <div className="border-b border-rose-200 bg-rose-50 px-5 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1 text-sm text-rose-900">
          <span className="font-medium">
            {broken
              ? "The reminder engine is not running."
              : `No maintenance sweep has run in over ${data.staleAfterHours} hours.`}
          </span>{" "}
          {broken
            ? "Maintenance can still be recorded, but no reminders are being sent."
            : "The nightly sweep runs at 02:00, so reminders may already be overdue."}
          {data.lastSweepAt && (
            <span className="mt-0.5 block text-xs text-rose-800">
              Last successful sweep: {formatDate(data.lastSweepAt)}.
            </span>
          )}
          {data.lastError && (
            <span className="mt-1 block break-words font-mono text-xs text-rose-800">
              {data.lastError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
