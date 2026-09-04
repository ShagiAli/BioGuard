import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  Boxes,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  History,
  Siren,
  Wrench,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  RotateCcw,
  X,
} from "lucide-react";
import {
  api,
  formatDate,
  titleCase,
  type AlertSummary,
  type SchedulerHealth,
} from "../lib/api";
import { useAuth } from "../auth";
import { Logo } from "./Logo";

const COLLAPSE_KEY = "bioguard.sidebar.collapsed";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end: boolean;
  count?: number;
}

/** "Ada Manager" becomes "AM". Falls back to a single letter, then nothing. */
function initials(name: string | undefined): string {
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  /**
   * Collapsed state survives a reload because it is a preference, not a
   * mode — someone who works in a narrow window should not have to
   * re-collapse on every visit. Storage is wrapped because it throws
   * outright in a private window and in some embedded contexts.
   */
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      /* a preference that cannot be saved is not worth failing over */
    }
  }, [collapsed]);

  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const nav: NavItem[] = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/equipment", label: "Equipment", icon: Boxes, end: false },
    { to: "/alerts", label: "Alerts", icon: Siren, end: false, count: alerts.data?.open },
    { to: "/work-orders", label: "Work orders", icon: Wrench, end: false },
    { to: "/notifications", label: "Notifications", icon: Bell, end: false, count: data?.unread },
    { to: "/mail", label: "Mail", icon: Mail, end: false, count: mail.data?.unread },
    ...(oversees ? [{ to: "/activity", label: "Activity", icon: History, end: false }] : []),
  ];

  const onSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside
        className={`hidden shrink-0 flex-col bg-brand-950 transition-[width] duration-200 md:flex ${
          collapsed ? "w-[4.5rem]" : "w-60"
        }`}
      >
        <SidebarContent
          nav={nav}
          collapsed={collapsed}
          user={user ? { fullName: user.fullName, role: user.role } : null}
        />
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex cursor-pointer items-center gap-3 border-t border-white/10 px-5 py-3 text-sm text-brand-200/70 transition hover:bg-white/5 hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>

      {/* Below md the sidebar is a drawer. Without it there is no way to
          move between pages on a phone at all. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          />
          <div
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-brand-950"
          >
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-4 cursor-pointer rounded p-1 text-brand-200/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
            <div onClick={() => setDrawerOpen(false)} className="flex min-h-0 flex-1 flex-col">
              <SidebarContent
                nav={nav}
                collapsed={false}
                user={user ? { fullName: user.fullName, role: user.role } : null}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-5">
          <button
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 cursor-pointer rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>

          {/* Global search belongs here in the new design. It is built —
              components/staged/CommandSearch — and waits on a search
              endpoint rather than on the interface. */}
          <div className="flex-1" />

          <NavLink
            to="/notifications"
            className="relative cursor-pointer rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`}
          >
            <Bell size={18} />
            {!!data?.unread && <Dot count={data.unread} />}
          </NavLink>

          <NavLink
            to="/mail"
            className="relative cursor-pointer rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label={`Mail${mail.data?.unread ? `, ${mail.data.unread} unread` : ""}`}
          >
            <Mail size={18} />
            {!!mail.data?.unread && <Dot count={mail.data.unread} />}
          </NavLink>

          <UserMenu
            fullName={user?.fullName ?? ""}
            role={user?.role ?? ""}
            onSignOut={onSignOut}
          />
        </header>

        {oversees && <SchedulerWarning />}
        {user?.role === "ADMIN" && <SimulateBar />}
        <main className="flex-1 overflow-auto p-4 md:p-5">{children}</main>
      </div>
    </div>
  );
}

/** The unread badge on a top-bar icon. Caps the number so a busy queue cannot stretch it. */
function Dot({ count }: { count: number }) {
  return (
    <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-rose-600 px-1 text-center font-mono text-[0.6rem] leading-4 text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Shared by the desktop rail and the mobile drawer, so the two cannot
 * drift into showing different navigation.
 */
function SidebarContent({
  nav,
  collapsed,
  user,
}: {
  nav: NavItem[];
  collapsed: boolean;
  user: { fullName: string; role: string } | null;
}) {
  return (
    <>
      <div className={`flex items-center gap-2.5 px-5 py-5 ${collapsed ? "justify-center px-0" : ""}`}>
        <Logo className="h-8 w-8 shrink-0 text-brand-500" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-lg font-semibold tracking-tight text-white">BioGuard</div>
            <div className="truncate text-[0.7rem] leading-tight text-brand-200/70">
              Protecting care. Protecting life.
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3">
        {nav.map(({ to, label, icon: Icon, end, count }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "bg-brand-600 font-medium text-white"
                  : "text-brand-100/75 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <Icon size={16} className="shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1">{label}</span>
                {!!count && (
                  <span className="rounded-full bg-rose-600 px-1.5 py-0.5 font-mono text-xs text-white">
                    {count}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div
          className={`flex items-center gap-3 border-t border-white/10 px-5 py-4 ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials(user.fullName)}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{user.fullName}</div>
              <div className="text-[0.65rem] uppercase tracking-wider text-brand-300/70">
                {titleCase(user.role)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Avatar and the one action behind it. Signing out is the only thing here, so the menu stays a menu rather than a settings page. */
function UserMenu({
  fullName,
  role,
  onSignOut,
}: {
  fullName: string;
  role: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 rounded-md py-1 pl-1 pr-2 transition hover:bg-slate-100"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-white">
          {initials(fullName)}
        </span>
        <span className="hidden text-sm text-slate-700 sm:block">{fullName}</span>
        <ChevronDown size={15} className="text-slate-400" />
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="border-b border-slate-100 px-3 py-2.5">
              <div className="truncate text-sm text-slate-800">{fullName}</div>
              <div className="text-xs text-slate-400">{titleCase(role)}</div>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </>
      )}
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
    <div className="border-b border-slate-200 bg-white px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-dashed border-brand-400 bg-brand-50 px-3 py-1.5">
          <Clock size={15} className="text-brand-700" />
          <div>
            <div className="text-xs uppercase tracking-wide text-brand-700">Run scheduler ahead</div>
            <div className="font-mono text-sm font-medium text-brand-900">Reminder engine</div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {[7, 14, 30, 90].map((n) => (
            <button
              key={n}
              disabled={busy}
              onClick={() => simulate.mutate(n)}
              className="cursor-pointer rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-600 transition hover:border-brand-400 hover:bg-slate-100 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
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
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
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
        <div className="mt-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
          {result}
        </div>
      )}
    </div>
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
    <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 md:px-5">
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
