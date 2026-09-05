/**
 * The maintenance position, preventive above corrective.
 *
 * Every figure is a link to the rows it counted, and every count comes
 * from the server scoped exactly as the list it opens — so a number and
 * the page behind it can never disagree. That property is older than
 * this layout and worth keeping through it.
 *
 * The priorities are EMERGENCY, MEDIUM and LOW because that is the enum.
 * The design shows a fourth band; inventing one here would put a row on
 * the dashboard that no alert can ever land in.
 */
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  PackageSearch,
  Siren,
  Wrench,
} from "lucide-react";
import {
  api,
  daysUntil,
  formatDate,
  formatDateTime,
  titleCase,
  type AlertSummary,
  type EquipmentRow,
  type Summary,
  type WorkOrder,
  type WorkOrderSummary,
} from "../lib/api";
import { useAuth } from "../auth";
import { Badge, Card, ErrorNote, Spinner, pmTone } from "../components/ui";

interface AuditRow {
  id: string;
  action: string;
  createdAt: string;
  actor: { fullName: string } | null;
  equipment: { name: string; assetNo: string } | null;
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const oversees = user?.role === "ADMIN" || user?.role === "MANAGER";

  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api.get<Summary>("/api/equipment/summary"),
  });

  const attention = useQuery({
    queryKey: ["attention"],
    queryFn: () => api.get<{ rows: EquipmentRow[] }>("/api/equipment?pm=DUE_30&pageSize=6"),
  });

  // The corrective side. Scoped on the server exactly as the lists are,
  // so each figure opens the rows it counted.
  const alerts = useQuery({
    queryKey: ["alerts", "summary"],
    queryFn: () => api.get<AlertSummary>("/api/alerts/summary"),
    refetchInterval: 60_000,
  });

  const work = useQuery({
    queryKey: ["work-orders", "summary"],
    queryFn: () => api.get<WorkOrderSummary>("/api/work-orders/summary"),
    refetchInterval: 60_000,
  });

  const closed = useQuery({
    queryKey: ["work-orders", "recently-closed"],
    queryFn: () =>
      api.get<{ rows: WorkOrder[] }>("/api/work-orders?archived=true&pageSize=5&sort=createdAt&dir=desc"),
  });

  // Activity is role-gated on the server, so it is not asked for at all
  // where it would come back empty.
  const activity = useQuery({
    queryKey: ["audit", "dashboard"],
    queryFn: () => api.get<{ rows: AuditRow[] }>("/api/audit?pageSize=6"),
    enabled: oversees,
  });

  if (summary.isLoading) return <Spinner label="Loading the maintenance position" />;
  if (summary.isError) return <ErrorNote message="Could not load the dashboard." />;

  const s = summary.data!;
  const a = alerts.data;
  const w = work.data;
  const operationalShare = s.total > 0 ? ((s.operational / s.total) * 100).toFixed(1) : "0.0";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Preventive maintenance and corrective work, across the estate you can see.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          <CalendarClock size={15} className="text-slate-400" />
          {formatDate(new Date().toISOString())}
        </div>
      </div>

      <SectionLabel>Preventive maintenance</SectionLabel>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Total equipment"
          value={s.total}
          icon={Boxes}
          tone="slate"
          to="/equipment"
          action="View equipment"
        />
        <Stat
          label="Operational"
          value={s.operational}
          hint={`${operationalShare}% of total`}
          icon={CheckCircle2}
          tone="emerald"
          to="/equipment?operationalStatus=OPERATIONAL"
          action="View operational"
        />
        <Stat
          label="Due within 30 days"
          value={s.due30}
          icon={Clock}
          tone="amber"
          to="/equipment?pm=DUE_30"
          action="View due soon"
        />
        <Stat
          label="Overdue"
          value={s.overdue}
          icon={AlertTriangle}
          tone="rose"
          to="/equipment?pm=OVERDUE"
          action="View overdue"
        />
        <Stat
          label="Critical overdue"
          value={s.criticalOverdue}
          icon={Siren}
          tone="rose"
          to="/equipment?pm=OVERDUE&criticality=CRITICAL"
          action="View critical"
        />
      </div>

      <SectionLabel>Corrective work</SectionLabel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Reported faults by priority" to="/alerts" linkLabel="View all alerts">
          <CountRow
            label="Emergency"
            value={a?.emergency}
            to="/alerts?priority=EMERGENCY"
            dot="bg-rose-500"
          />
          <CountRow label="Medium" value={a?.medium} to="/alerts?priority=MEDIUM" dot="bg-amber-500" />
          <CountRow label="Low" value={a?.low} to="/alerts?priority=LOW" dot="bg-emerald-500" />
          <CountRow
            label="Waiting for assignment"
            value={a?.awaitingAssignment}
            to="/alerts?status=OPEN"
            dot="bg-slate-300"
          />
          <Total label="Total open alerts" value={a?.open} to="/alerts" />
        </Panel>

        <Panel title="Repairs in progress" to="/work-orders" linkLabel="View work orders">
          <CountRow label="In progress" value={w?.inProgress} to="/work-orders" icon={Wrench} />
          <CountRow
            label="Awaiting parts"
            value={w?.awaitingParts}
            to="/work-orders?status=AWAITING_PARTS"
            icon={PackageSearch}
          />
          <CountRow label="Parts on order" value={w?.partsOrdered} to="/work-orders" icon={Clock} />
          <Total
            label="Closed work orders"
            value={w?.closed}
            to="/work-orders?archived=true"
          />
        </Panel>

        <Panel title="Recently closed" to="/work-orders?archived=true" linkLabel="View archive">
          {closed.data?.rows.length ? (
            <ul className="-mx-4 divide-y divide-slate-100">
              {closed.data.rows.map((wo) => (
                <li key={wo.id}>
                  <Link
                    to={`/work-orders/${wo.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50"
                  >
                    <span className="font-mono text-xs text-slate-500">{wo.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {wo.equipment.name}
                    </span>
                    <Badge tone="emerald">Closed</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">Nothing closed yet.</p>
          )}
        </Panel>
      </div>

      <SectionLabel>What is coming up</SectionLabel>

      <div className={`grid gap-4 ${oversees ? "lg:grid-cols-2" : ""}`}>
        <Card>
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-800">Next services due</h2>
            <Link
              to="/equipment?pm=DUE_30"
              className="flex items-center gap-0.5 text-xs text-brand-700 hover:text-brand-800"
            >
              View all <ChevronRight size={13} />
            </Link>
          </header>

          {attention.data?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Due</th>
                    <th className="px-4 py-2.5 font-medium">Device</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Asset</th>
                    <th className="px-4 py-2.5 font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attention.data.rows.map((d) => {
                    const days = daysUntil(d.nextDueAt);
                    return (
                      <tr
                        key={d.id}
                        onClick={() => navigate(`/equipment/${d.id}`)}
                        className="cursor-pointer transition hover:bg-slate-50"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-xs text-slate-600">
                            {formatDate(d.nextDueAt)}
                          </div>
                          {days !== null && (
                            <div className="text-xs text-slate-400">
                              {days < 0
                                ? `${Math.abs(days)}d overdue`
                                : days === 0
                                  ? "today"
                                  : `in ${days}d`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-800">{d.name}</td>
                        <td className="hidden px-4 py-2.5 font-mono text-xs text-slate-500 sm:table-cell">
                          {d.assetNo}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={pmTone(d.pmState)}>{titleCase(d.pmState)}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Nothing due in the next thirty days.
            </p>
          )}
        </Card>

        {oversees && (
          <Card>
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-800">Latest activity</h2>
              <Link
                to="/activity"
                className="flex items-center gap-0.5 text-xs text-brand-700 hover:text-brand-800"
              >
                View feed <ChevronRight size={13} />
              </Link>
            </header>

            {activity.data?.rows.length ? (
              <ul className="divide-y divide-slate-100">
                {activity.data.rows.map((row) => (
                  <li key={row.id} className="flex gap-3 px-4 py-2.5">
                    <ActivityIcon size={14} className="mt-1 shrink-0 text-brand-600" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800">
                        {titleCase(row.action.replace(/[._]/g, " "))}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {row.equipment ? `${row.equipment.name} · ` : ""}
                        {row.actor?.fullName ?? "System"}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-slate-400">
                      {formatDateTime(row.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing recorded yet.</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-7 text-xs font-medium uppercase tracking-wider text-slate-400">
      {children}
    </h2>
  );
}

const STAT_TONES = {
  slate: "text-slate-400",
  emerald: "text-emerald-600",
  amber: "text-amber-600",
  rose: "text-rose-600",
} as const;

/**
 * One figure, and the list it counted.
 *
 * The whole tile is the link. A number somebody cannot click is a number
 * they have to go and look up somewhere else.
 */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  to,
  action,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Boxes;
  tone: keyof typeof STAT_TONES;
  to: string;
  action: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-slate-500">{label}</span>
        <Icon size={16} className={STAT_TONES[tone]} />
      </div>
      <span className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
        {value}
      </span>
      <span className="mt-0.5 text-xs text-slate-400">{hint ?? " "}</span>
      <span className="mt-3 flex items-center gap-0.5 text-xs text-brand-700 group-hover:text-brand-800">
        {action} <ChevronRight size={13} />
      </span>
    </Link>
  );
}

function Panel({
  title,
  to,
  linkLabel,
  children,
}: {
  title: string;
  to: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col p-4">
      <header className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-800">{title}</h3>
        <Link
          to={to}
          className="flex shrink-0 items-center gap-0.5 text-xs text-brand-700 hover:text-brand-800"
        >
          {linkLabel} <ChevronRight size={13} />
        </Link>
      </header>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

function CountRow({
  label,
  value,
  to,
  dot,
  icon: Icon,
}: {
  label: string;
  value: number | undefined;
  to: string;
  dot?: string;
  icon?: typeof Boxes;
}) {
  return (
    <Link
      to={to}
      className="-mx-2 flex items-center gap-2.5 rounded px-2 py-2 transition hover:bg-slate-50"
    >
      {dot && <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
      {Icon && <Icon size={14} className="shrink-0 text-slate-400" />}
      <span className="flex-1 text-sm text-slate-600">{label}</span>
      <span className="font-mono text-sm tabular-nums text-slate-800">{value ?? "—"}</span>
    </Link>
  );
}

function Total({ label, value, to }: { label: string; value: number | undefined; to: string }) {
  return (
    <Link
      to={to}
      className="-mx-2 mt-1 flex items-center gap-2 rounded border-t border-slate-200 px-2 pb-1 pt-3 transition hover:bg-slate-50"
    >
      <span className="flex-1 text-sm font-medium text-slate-700">{label}</span>
      <span className="font-mono text-sm font-medium tabular-nums text-slate-900">
        {value ?? "—"}
      </span>
    </Link>
  );
}
