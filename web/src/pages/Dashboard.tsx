import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import {
  api,
  daysUntil,
  formatDate,
  type AlertSummary,
  type EquipmentRow,
  type Summary,
  type WorkOrderSummary,
} from "../lib/api";
import { Badge, Card, ErrorNote, Spinner, pmTone } from "../components/ui";

export function Dashboard() {
  const navigate = useNavigate();

  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api.get<Summary>("/api/equipment/summary"),
  });

  const attention = useQuery({
    queryKey: ["attention"],
    queryFn: () =>
      api.get<{ rows: EquipmentRow[] }>("/api/equipment?pm=DUE_30&pageSize=8"),
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

  if (summary.isLoading) return <Spinner label="Loading the maintenance position" />;
  if (summary.isError) return <ErrorNote message="Could not load the dashboard." />;

  const s = summary.data!;

  // Each figure navigates to the list filtered by the same predicate the
  // count was computed from, so the two can never disagree.
  const cards = [
    { label: "Total devices", value: s.total, query: "" },
    { label: "Operational", value: s.operational, query: "?operationalStatus=OPERATIONAL" },
    { label: "Due within 30 days", value: s.due30, query: "?pm=DUE_30", tone: "amber" },
    { label: "Overdue", value: s.overdue, query: "?pm=OVERDUE", tone: "rose" },
    {
      label: "Critical overdue",
      value: s.criticalOverdue,
      query: "?pm=OVERDUE&criticality=CRITICAL",
      tone: "rose",
    },
  ];

  const a = alerts.data;
  const w = work.data;

  /** Every figure links to the list filtered by the predicate behind it. */
  const alertCards = a && [
    { label: "Emergency", value: a.emergency, to: "/alerts?priority=EMERGENCY", tone: "rose" },
    { label: "Medium", value: a.medium, to: "/alerts?priority=MEDIUM", tone: "amber" },
    { label: "Low", value: a.low, to: "/alerts?priority=LOW" },
    {
      label: "Waiting for assignment",
      value: a.awaitingAssignment,
      to: "/alerts?status=OPEN",
      tone: a.awaitingAssignment > 0 ? "amber" : undefined,
    },
  ];

  const workCards = w && [
    { label: "Work orders in progress", value: w.inProgress, to: "/work-orders" },
    {
      label: "Awaiting parts",
      value: w.awaitingParts,
      to: "/work-orders",
      tone: w.awaitingParts > 0 ? "amber" : undefined,
    },
    { label: "Parts on order", value: w.partsOrdered, to: "/work-orders" },
    { label: "Closed work orders", value: w.closed, to: "/work-orders?archived=true" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-xl font-medium text-slate-900">Maintenance overview</h1>
      <p className="mt-1 text-sm text-slate-500">
        Preventive maintenance position across {s.total} devices. Every figure opens the equipment
        behind it.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => navigate(`/equipment${c.query}`)}
            className="group cursor-pointer rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-teal-400 hover:bg-slate-100"
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">{c.label}</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span
                className={`font-mono text-3xl ${
                  c.tone === "rose"
                    ? "text-rose-600"
                    : c.tone === "amber"
                      ? "text-amber-600"
                      : "text-slate-900"
                }`}
              >
                {c.value}
              </span>
              <ChevronRight size={15} className="text-slate-300 group-hover:text-teal-600" />
            </div>
          </button>
        ))}
      </div>

      {s.criticalOverdue > 0 && (
        <div className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
          <div className="min-w-56 flex-1 text-sm text-rose-900">
            <span className="font-medium">
              {s.criticalOverdue} critical device{s.criticalOverdue === 1 ? " is" : "s are"} past the
              maintenance due date.
            </span>{" "}
            Critical equipment is life-supporting or life-sustaining, so these are cleared first.
          </div>
          <Link
            to="/equipment?pm=OVERDUE&criticality=CRITICAL"
            className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Show the {s.criticalOverdue}
          </Link>
        </div>
      )}

      {a && a.open > 0 && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-slate-800">
              Reported faults ({a.open} unresolved)
            </h2>
            <Link to="/alerts" className="text-xs text-teal-700 hover:text-teal-900">
              All alerts
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {alertCards!.map((c) => (
              <FigureCard key={c.label} {...c} />
            ))}
          </div>
        </section>
      )}

      {w && (w.inProgress > 0 || w.closed > 0) && (
        <section className="mt-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-slate-800">Repairs</h2>
            <Link to="/work-orders" className="text-xs text-teal-700 hover:text-teal-900">
              All work orders
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {workCards!.map((c) => (
              <FigureCard key={c.label} {...c} />
            ))}
          </div>
        </section>
      )}

      <Card className="mt-5">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800">Due within 30 days</h2>
          <span className="text-xs text-slate-400">Soonest first</span>
        </header>

        {attention.isLoading ? (
          <Spinner />
        ) : attention.data?.rows.length === 0 ? (
          <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
            <CheckCircle2 size={16} className="text-emerald-600" />
            Nothing due in the next month.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {attention.data?.rows.map((d) => {
              const remaining = daysUntil(d.nextDueAt);
              return (
                <li key={d.id}>
                  <Link
                    to={`/equipment/${d.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-100"
                  >
                    <Badge tone={pmTone(d.pmState)}>
                      {remaining !== null && remaining < 0 ? `${-remaining}d late` : `${remaining}d`}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-800">
                        {d.name} <span className="font-mono text-xs text-slate-400">{d.assetNo}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {d.department.name}
                        {d.room && ` · Room ${d.room.code}`}
                        {d.engineer && ` · ${d.engineer.fullName}`}
                      </div>
                    </div>
                    <span className="hidden font-mono text-xs text-slate-400 sm:block">
                      {formatDate(d.nextDueAt)}
                    </span>
                    {d.criticality === "CRITICAL" && <Badge tone="rose">Critical</Badge>}
                    <ChevronRight size={15} className="text-slate-300" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * One clickable figure.
 *
 * A link rather than a button, so it can be opened in a new tab and
 * copied — the same reason the equipment filters live in the URL.
 */
function FigureCard({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: number;
  to: string;
  tone?: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal-400 hover:bg-slate-100"
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex items-baseline justify-between">
        <span
          className={`font-mono text-3xl ${
            tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-slate-900"
          }`}
        >
          {value}
        </span>
        <ChevronRight size={15} className="text-slate-300 group-hover:text-teal-600" />
      </div>
    </Link>
  );
}
