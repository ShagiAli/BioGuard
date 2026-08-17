import React, { useState, useMemo, useCallback } from "react";
import {
  LayoutDashboard,
  Boxes,
  Bell,
  Search,
  Clock,
  ChevronRight,
  X,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  Wrench,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Date helpers. All dates are plain YYYY-MM-DD strings handled in UTC
 * so the interval arithmetic never shifts across a timezone boundary.
 * ------------------------------------------------------------------ */

const DAY_MS = 86400000;

function toUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * DAY_MS);
}

/** Days from `a` until `b`. Negative when b is in the past. */
function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

/* ------------------------------------------------------------------ *
 * Scheduling rules
 * ------------------------------------------------------------------ */

const GRACE_RATIO = 0.2;

function graceDays(intervalDays) {
  return Math.round(intervalDays * GRACE_RATIO);
}

/**
 * Works out the next due date after a maintenance record is filed.
 *
 * anchored  - next due is always previous due + interval, whatever the
 *             completion date. Used where an external certificate or a
 *             fixed annual test governs the date.
 * grace     - keeps the anchor if the work landed inside the grace
 *             window, otherwise re-bases onto the completion date and
 *             records that a re-base happened.
 */
function recalculateDue({ scheduleMode, previousDue, completedOn, intervalDays }) {
  const lateness = daysBetween(previousDue, completedOn);
  const allowed = graceDays(intervalDays);

  if (scheduleMode === "anchored") {
    return { nextDue: addDays(previousDue, intervalDays), rebased: false, lateness };
  }
  if (lateness <= allowed) {
    return { nextDue: addDays(previousDue, intervalDays), rebased: false, lateness };
  }
  return { nextDue: addDays(completedOn, intervalDays), rebased: true, lateness };
}

const THRESHOLDS = [
  { at: 30, level: "info", label: "due in 30 days" },
  { at: 14, level: "warning", label: "due in 14 days" },
  { at: 7, level: "urgent", label: "due in 7 days" },
  { at: 1, level: "urgent", label: "due tomorrow" },
  { at: 0, level: "due", label: "due today" },
];

/**
 * Runs one day of the scheduler. Pure: give it a date and the fleet,
 * it returns the notifications that should fire on that date. The same
 * function backs the nightly cron job and the time-travel control.
 */
function runScheduler(fleet, onDate, alreadySent) {
  const fired = [];

  for (const device of fleet) {
    if (device.opStatus === "Retired") continue;
    const remaining = daysBetween(onDate, device.nextDue);

    let match = null;
    if (remaining >= 0) {
      match = THRESHOLDS.find((t) => t.at === remaining) || null;
    } else {
      const overdueBy = -remaining;
      if (overdueBy === 1 || overdueBy % 7 === 0) {
        match = {
          at: remaining,
          level: "overdue",
          label: `overdue by ${overdueBy} day${overdueBy === 1 ? "" : "s"}`,
        };
      }
    }
    if (!match) continue;

    // One notification per device, per due date, per threshold.
    const key = `${device.id}|${device.nextDue}|${match.at}`;
    if (alreadySent.has(key)) continue;
    alreadySent.add(key);

    fired.push({
      key,
      deviceId: device.id,
      deviceName: device.name,
      assetNo: device.assetNo,
      level: match.level,
      message: `Preventive maintenance ${match.label}`,
      recipient: device.engineer,
      date: onDate,
      read: false,
    });
  }
  return fired;
}

/* ------------------------------------------------------------------ *
 * Demo data. Fictional hospital, deterministic generator so the
 * numbers are identical every time the prototype loads.
 * ------------------------------------------------------------------ */

const HOSPITAL = "Northfield Teaching Hospital";
const START_DATE = "2026-08-14";

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  { name: "Ventilator", interval: 90, criticality: "Critical" },
  { name: "Anaesthesia machine", interval: 90, criticality: "Critical" },
  { name: "Defibrillator", interval: 90, criticality: "Critical" },
  { name: "Infant incubator", interval: 90, criticality: "Critical" },
  { name: "Dialysis machine", interval: 120, criticality: "Critical" },
  { name: "Patient monitor", interval: 180, criticality: "High" },
  { name: "Infusion pump", interval: 180, criticality: "High" },
  { name: "Syringe pump", interval: 180, criticality: "High" },
  { name: "Autoclave", interval: 180, criticality: "High" },
  { name: "X-ray unit", interval: 365, criticality: "High" },
  { name: "ECG machine", interval: 180, criticality: "Medium" },
  { name: "Ultrasound scanner", interval: 365, criticality: "Medium" },
  { name: "Surgical light", interval: 365, criticality: "Medium" },
  { name: "Centrifuge", interval: 365, criticality: "Medium" },
  { name: "Pulse oximeter", interval: 365, criticality: "Low" },
  { name: "Suction unit", interval: 365, criticality: "Low" },
  { name: "Nebuliser", interval: 365, criticality: "Low" },
];

const MANUFACTURERS = [
  "Dräger", "Philips", "GE Healthcare", "Mindray", "Siemens Healthineers",
  "Nihon Kohden", "B. Braun", "Fresenius", "Getinge", "Medtronic",
];

const DEPARTMENTS = [
  { name: "Intensive care", building: "A Block", floor: 3 },
  { name: "Emergency", building: "A Block", floor: 0 },
  { name: "Operating theatres", building: "A Block", floor: 2 },
  { name: "Neonatal ICU", building: "B Block", floor: 3 },
  { name: "Cardiology", building: "B Block", floor: 1 },
  { name: "Paediatrics", building: "B Block", floor: 2 },
  { name: "Dialysis unit", building: "C Block", floor: 1 },
  { name: "Radiology", building: "C Block", floor: 0 },
  { name: "Internal medicine", building: "C Block", floor: 2 },
  { name: "Laboratory", building: "C Block", floor: 3 },
];

const ENGINEERS = ["James Carter", "Sarah Bennett", "Michael Doyle", "Emma Whitfield"];

const OP_STATUSES = ["Operational", "Operational", "Operational", "Operational",
  "Operational", "Operational", "Under repair", "Awaiting parts", "Out of service"];

function buildFleet() {
  const rnd = mulberry32(20260814);
  const fleet = [];

  for (let i = 0; i < 184; i++) {
    const cat = CATEGORIES[Math.floor(rnd() * CATEGORIES.length)];
    const dept = DEPARTMENTS[Math.floor(rnd() * DEPARTMENTS.length)];
    const manufacturer = MANUFACTURERS[Math.floor(rnd() * MANUFACTURERS.length)];
    const engineer = ENGINEERS[Math.floor(rnd() * ENGINEERS.length)];
    const opStatus = OP_STATUSES[Math.floor(rnd() * OP_STATUSES.length)];

    // Spread the fleet across the maintenance cycle: most healthy,
    // a tail already overdue.
    const position = rnd();
    let elapsed;
    if (position > 0.93) elapsed = cat.interval + Math.floor(rnd() * 45) + 2;
    else if (position > 0.82) elapsed = cat.interval - Math.floor(rnd() * 7);
    else if (position > 0.66) elapsed = cat.interval - 8 - Math.floor(rnd() * 22);
    else elapsed = Math.floor(rnd() * (cat.interval - 30));

    const lastCompleted = addDays(START_DATE, -elapsed);
    const serial = String(Math.floor(rnd() * 900000) + 100000);
    const seq = String(i + 1).padStart(6, "0");

    fleet.push({
      id: `BG-EQ-${seq}`,
      assetNo: `${dept.building.charAt(0)}${String(1000 + i)}`,
      name: cat.name,
      category: cat.name,
      manufacturer,
      model: `${manufacturer.split(" ")[0].slice(0, 3).toUpperCase()}-${100 + Math.floor(rnd() * 800)}`,
      serial,
      department: dept.name,
      building: dept.building,
      floor: dept.floor,
      room: `${dept.floor}${String(Math.floor(rnd() * 40) + 1).padStart(2, "0")}`,
      criticality: cat.criticality,
      opStatus,
      engineer,
      intervalDays: cat.interval,
      intervalSource: rnd() > 0.75 ? "Hospital policy" : "Manufacturer",
      scheduleMode: cat.interval >= 365 && rnd() > 0.6 ? "anchored" : "grace",
      lastCompleted,
      nextDue: addDays(lastCompleted, cat.interval),
      history: [
        {
          date: lastCompleted,
          type: "Preventive maintenance",
          engineer,
          work: "Scheduled service completed. Functional and safety checks passed.",
          cost: Math.floor(rnd() * 3000) + 250,
          downtime: Math.floor(rnd() * 5) + 1,
          rebased: false,
        },
      ],
    });
  }
  return fleet;
}

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

const ROLES = {
  Administrator: { canRecord: true, canSeeCost: true, canReport: true },
  "Biomedical engineer": { canRecord: true, canSeeCost: true, canReport: true },
  Manager: { canRecord: false, canSeeCost: true, canReport: false },
  "Hospital staff": { canRecord: false, canSeeCost: false, canReport: true },
};

/* ------------------------------------------------------------------ *
 * Filtering. Every dashboard figure is a saved query over these axes,
 * so a headline count and the list behind it cannot disagree.
 * ------------------------------------------------------------------ */

const EMPTY_FILTERS = { dept: "All", pm: "All", criticality: "All", opStatus: "All" };
const PM_FILTERS = ["All", "Overdue", "Due within 30 days", "Due now", "Due soon", "Scheduled"];
const CRITICALITIES = ["All", "Critical", "High", "Medium", "Low"];
const STATUS_FILTERS = ["All", "Operational", "Under repair", "Awaiting parts", "Out of service"];
const FILTER_LABELS = { dept: "Department", pm: "Maintenance", criticality: "Criticality", opStatus: "Status" };

function matchesPm(label, filter) {
  if (filter === "All") return true;
  if (filter === "Due within 30 days") return label === "Due now" || label === "Due soon";
  return label === filter;
}

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

function pmState(device, today) {
  const remaining = daysBetween(today, device.nextDue);
  if (remaining < 0) return { label: "Overdue", tone: "rose", remaining };
  if (remaining <= 7) return { label: "Due now", tone: "amber", remaining };
  if (remaining <= 30) return { label: "Due soon", tone: "sky", remaining };
  return { label: "Scheduled", tone: "slate", remaining };
}

const TONES = {
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  slate: "bg-slate-50 text-slate-600 border-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  teal: "bg-teal-50 text-teal-800 border-teal-200",
};

function Badge({ tone = "slate", children }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

function Field({ label, children, mono }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm text-slate-800 ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

function StatCard({ label, value, tone = "slate", onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`group cursor-pointer rounded-lg border p-4 text-left transition ${
        active ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white hover:border-teal-400 hover:bg-slate-100"
      }`}
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
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Main application
 * ------------------------------------------------------------------ */

export default function BioGuard() {
  const [today, setToday] = useState(START_DATE);
  const [fleet, setFleet] = useState(() => buildFleet());
  const [notifications, setNotifications] = useState([]);
  const [sentKeys] = useState(() => new Set());
  const [role, setRole] = useState("Biomedical engineer");
  const [view, setView] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState(null);

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const perms = ROLES[role];
  const selected = fleet.find((d) => d.id === selectedId) || null;

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  /* Advance the clock one day at a time, running the scheduler on each
     day so no threshold is skipped over. */
  const advance = useCallback(
    (days) => {
      let cursor = today;
      const collected = [];
      for (let i = 0; i < days; i++) {
        cursor = addDays(cursor, 1);
        collected.push(...runScheduler(fleet, cursor, sentKeys));
      }
      setToday(cursor);
      if (collected.length) {
        setNotifications((prev) => [...collected.reverse(), ...prev]);
        showToast(`${collected.length} notification${collected.length === 1 ? "" : "s"} sent`);
      } else {
        showToast("No notifications due");
      }
    },
    [today, fleet, sentKeys, showToast]
  );

  const resetClock = useCallback(() => {
    setFleet(buildFleet());
    setNotifications([]);
    sentKeys.clear();
    setToday(START_DATE);
    setSelectedId(null);
    showToast("Reset to 14 Aug 2026");
  }, [sentKeys, showToast]);

  const recordMaintenance = useCallback(
    (device, form) => {
      const result = recalculateDue({
        scheduleMode: device.scheduleMode,
        previousDue: device.nextDue,
        completedOn: form.date,
        intervalDays: device.intervalDays,
      });

      setFleet((prev) =>
        prev.map((d) =>
          d.id !== device.id
            ? d
            : {
                ...d,
                lastCompleted: form.date,
                nextDue: result.nextDue,
                opStatus: "Operational",
                history: [
                  {
                    date: form.date,
                    type: form.type,
                    engineer: form.engineer,
                    work: form.work || "No description recorded.",
                    cost: Number(form.cost) || 0,
                    downtime: Number(form.downtime) || 0,
                    rebased: result.rebased,
                    lateness: result.lateness,
                  },
                  ...d.history,
                ],
              }
        )
      );

      // Pending reminders for the due date just satisfied no longer apply.
      setNotifications((prev) =>
        prev.filter((n) => !(n.deviceId === device.id && n.key.includes(device.nextDue)))
      );

      setRecording(false);
      showToast(
        result.rebased
          ? `Recorded. Schedule re-based — ${result.lateness} days late, outside the ${graceDays(
              device.intervalDays
            )}-day grace window.`
          : "Recorded. Next due date set, original schedule kept."
      );
    },
    [showToast]
  );

  const reportProblem = useCallback(
    (device) => {
      setFleet((prev) =>
        prev.map((d) => (d.id === device.id ? { ...d, opStatus: "Under repair" } : d))
      );
      setNotifications((prev) => [
        {
          key: `${device.id}|fault|${today}|${prev.length}`,
          deviceId: device.id,
          deviceName: device.name,
          assetNo: device.assetNo,
          level: "urgent",
          message: "Fault reported by ward staff",
          recipient: device.engineer,
          date: today,
          read: false,
        },
        ...prev,
      ]);
      showToast("Problem reported. The assigned engineer has been notified.");
    },
    [today, showToast]
  );

  /* Derived numbers */
  const stats = useMemo(() => {
    let overdue = 0, dueSoon = 0, operational = 0, outOfService = 0, criticalOverdue = 0;
    for (const d of fleet) {
      const s = pmState(d, today);
      if (s.label === "Overdue") {
        overdue++;
        if (d.criticality === "Critical") criticalOverdue++;
      } else if (s.label === "Due now" || s.label === "Due soon") dueSoon++;
      if (d.opStatus === "Operational") operational++;
      if (d.opStatus === "Out of service" || d.opStatus === "Under repair") outOfService++;
    }
    return { total: fleet.length, overdue, dueSoon, operational, outOfService, criticalOverdue };
  }, [fleet, today]);

  const byDepartment = useMemo(() => {
    const map = new Map();
    for (const d of fleet) {
      const row = map.get(d.department) || { total: 0, overdue: 0 };
      row.total++;
      if (pmState(d, today).label === "Overdue") row.overdue++;
      map.set(d.department, row);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [fleet, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fleet
      .filter((d) => {
        if (filters.dept !== "All" && d.department !== filters.dept) return false;
        if (filters.criticality !== "All" && d.criticality !== filters.criticality) return false;
        if (filters.opStatus !== "All" && d.opStatus !== filters.opStatus) return false;
        if (!matchesPm(pmState(d, today).label, filters.pm)) return false;
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q) ||
          d.assetNo.toLowerCase().includes(q) ||
          d.serial.includes(q) ||
          d.manufacturer.toLowerCase().includes(q) ||
          d.model.toLowerCase().includes(q) ||
          d.engineer.toLowerCase().includes(q) ||
          d.room.includes(q)
        );
      })
      .sort((a, b) => daysBetween(today, a.nextDue) - daysBetween(today, b.nextDue));
  }, [fleet, query, filters, today]);

  const attention = useMemo(
    () =>
      [...fleet]
        .filter((d) => daysBetween(today, d.nextDue) <= 14 && d.opStatus !== "Retired")
        .sort((a, b) => daysBetween(today, a.nextDue) - daysBetween(today, b.nextDue))
        .slice(0, 8),
    [fleet, today]
  );

  const unread = notifications.filter((n) => !n.read).length;

  const openDevice = (id) => {
    setSelectedId(id);
    setView("equipment");
  };

  /* Every clickable figure on the dashboard funnels through here, so the
     number shown and the rows listed always come from one predicate. */
  const drill = useCallback((patch) => {
    setFilters({ ...EMPTY_FILTERS, ...patch });
    setQuery("");
    setSelectedId(null);
    setView("equipment");
  }, []);

  /* ---------------------------------------------------------------- */

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-5">
          <div className="font-mono text-lg font-semibold tracking-tight text-teal-800">BioGuard</div>
          <div className="mt-1 text-xs leading-snug text-slate-500">{HOSPITAL}</div>
        </div>
        <nav className="flex-1 p-3">
          {[
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
            { id: "equipment", label: "Equipment", icon: Boxes },
            { id: "notifications", label: "Notifications", icon: Bell, count: unread },
          ].map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  setSelectedId(null);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-teal-50 font-medium text-teal-900" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon size={16} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.count > 0 && (
                  <span className="rounded-full bg-rose-600 px-1.5 py-0.5 font-mono text-xs text-white">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="mb-1 px-1 text-xs uppercase tracking-wide text-slate-400">Signed in as</div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            {Object.keys(ROLES).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clock bar — the signature control. Styled like a calibration
            sticker because that is exactly what it represents. */}
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex items-center gap-2 rounded-md border border-dashed border-teal-400 bg-teal-50 px-3 py-1.5">
            <Clock size={15} className="text-teal-700" />
            <div>
              <div className="text-xs uppercase tracking-wide text-teal-700">System date</div>
              <div className="font-mono text-sm font-medium text-teal-900">{formatDate(today)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {[1, 7, 30, 90].map((n) => (
              <button
                key={n}
                onClick={() => advance(n)}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-600 hover:border-teal-400 hover:text-teal-800"
              >
                +{n}d
              </button>
            ))}
            <button
              onClick={resetClock}
              className="ml-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800"
            >
              <RotateCcw size={13} /> Reset
            </button>
          </div>
          <div className="ml-auto text-xs text-slate-400">
            Advancing the clock runs the nightly scheduler for each day passed.
          </div>
        </header>

        <main className="flex-1 overflow-auto p-5">
          {view === "dashboard" && (
            <Dashboard
              stats={stats}
              attention={attention}
              byDepartment={byDepartment}
              today={today}
              onOpen={openDevice}
              onDrill={drill}
            />
          )}

          {view === "equipment" && !selected && (
            <EquipmentList
              rows={filtered}
              total={fleet.length}
              today={today}
              query={query}
              setQuery={setQuery}
              filters={filters}
              setFilters={setFilters}
              onOpen={openDevice}
            />
          )}

          {view === "equipment" && selected && (
            <DeviceDetail
              device={selected}
              today={today}
              perms={perms}
              onBack={() => setSelectedId(null)}
              onRecord={() => setRecording(true)}
              onReport={() => reportProblem(selected)}
            />
          )}

          {view === "notifications" && (
            <NotificationCentre
              items={notifications}
              onOpen={openDevice}
              onMarkAll={() =>
                setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
              }
            />
          )}
        </main>
      </div>

      {recording && selected && (
        <RecordDialog
          device={selected}
          today={today}
          onClose={() => setRecording(false)}
          onSave={(form) => recordMaintenance(selected, form)}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function Dashboard({ stats, attention, byDepartment, today, onOpen, onDrill }) {
  const maxDept = Math.max(...byDepartment.map(([, v]) => v.total), 1);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-xl font-medium text-slate-900">Maintenance overview</h1>
      <p className="mt-1 text-sm text-slate-500">
        Preventive maintenance position across {stats.total} devices as of {formatDate(today)}. Every
        figure below opens the devices behind it.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total devices" value={stats.total} onClick={() => onDrill({})} />
        <StatCard
          label="Operational"
          value={stats.operational}
          onClick={() => onDrill({ opStatus: "Operational" })}
        />
        <StatCard
          label="Due within 30 days"
          value={stats.dueSoon}
          tone="amber"
          onClick={() => onDrill({ pm: "Due within 30 days" })}
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          tone="rose"
          onClick={() => onDrill({ pm: "Overdue" })}
        />
        <StatCard
          label="Critical overdue"
          value={stats.criticalOverdue}
          tone="rose"
          onClick={() => onDrill({ pm: "Overdue", criticality: "Critical" })}
        />
      </div>

      {stats.criticalOverdue > 0 && (
        <div className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
          <div className="min-w-56 flex-1 text-sm text-rose-900">
            <span className="font-medium">
              {stats.criticalOverdue} critical device{stats.criticalOverdue === 1 ? " is" : "s are"} past
              the maintenance due date.
            </span>{" "}
            Critical equipment is life-supporting or life-sustaining, so these are cleared before
            anything else on the list.
          </div>
          <button
            onClick={() => onDrill({ pm: "Overdue", criticality: "Critical" })}
            className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Show the {stats.criticalOverdue}
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-lg border border-slate-200 bg-white">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-800">Needs attention within 14 days</h2>
            <span className="text-xs text-slate-400">Soonest first</span>
          </header>
          {attention.length === 0 ? (
            <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
              <CheckCircle2 size={16} className="text-emerald-600" />
              Nothing due in the next fortnight. Advance the clock to see the schedule move.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((d) => {
                const s = pmState(d, today);
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => onOpen(d.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <Badge tone={s.tone}>
                        {s.remaining < 0 ? `${-s.remaining}d late` : `${s.remaining}d`}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-slate-800">
                          {d.name}{" "}
                          <span className="font-mono text-xs text-slate-400">{d.assetNo}</span>
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {d.department} · Room {d.room} · {d.engineer}
                        </div>
                      </div>
                      {d.criticality === "Critical" && <Badge tone="rose">Critical</Badge>}
                      <ChevronRight size={15} className="text-slate-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-800">Devices by department</h2>
          </header>
          <ul className="p-2">
            {byDepartment.map(([dept, v]) => (
              <li key={dept}>
                <button
                  onClick={() => onDrill({ dept })}
                  className="w-full rounded-md p-2 text-left hover:bg-slate-50"
                >
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-600">{dept}</span>
                    <span className="font-mono text-slate-500">
                      {v.total}
                      {v.overdue > 0 && <span className="text-rose-600"> · {v.overdue} overdue</span>}
                    </span>
                  </div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-slate-100">
                    <div className="bg-rose-500" style={{ width: `${(v.overdue / maxDept) * 100}%` }} />
                    <div
                      className="bg-teal-600"
                      style={{ width: `${((v.total - v.overdue) / maxDept) * 100}%` }}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function EquipmentList({ rows, total, today, query, setQuery, filters, setFilters, onOpen }) {
  const active = Object.entries(filters).filter(([, v]) => v !== "All");
  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-xl font-medium text-slate-900">Equipment</h1>
      <p className="mt-1 text-sm text-slate-500">
        Showing {rows.length} of {total} devices.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, asset number, serial, engineer, room"
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-500"
          />
        </div>
        <select
          value={filters.dept}
          onChange={set("dept")}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option>All</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.name}>{d.name}</option>
          ))}
        </select>
        <select
          value={filters.pm}
          onChange={set("pm")}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          {PM_FILTERS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={filters.criticality}
          onChange={set("criticality")}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          {CRITICALITIES.map((s) => (
            <option key={s}>{s === "All" ? "All criticalities" : s}</option>
          ))}
        </select>
        <select
          value={filters.opStatus}
          onChange={set("opStatus")}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s}>{s === "All" ? "All statuses" : s}</option>
          ))}
        </select>
      </div>

      {active.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-400">Filtered by</span>
          {active.map(([key, value]) => (
            <button
              key={key}
              onClick={() => setFilters({ ...filters, [key]: "All" })}
              className="flex items-center gap-1.5 rounded border border-teal-200 bg-teal-50 px-2 py-1 text-xs text-teal-900 hover:border-teal-400"
            >
              <span className="text-teal-600">{FILTER_LABELS[key]}:</span> {value}
              <X size={12} />
            </button>
          ))}
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-xs text-slate-500 underline hover:text-slate-800"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-600">No devices match these filters.</p>
            <button
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setQuery("");
              }}
              className="mt-2 text-sm text-teal-700 underline hover:text-teal-900"
            >
              Clear the filters
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Asset</th>
                <th className="px-4 py-2.5 font-medium">Device</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Location</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Engineer</th>
                <th className="px-4 py-2.5 font-medium">Next PM</th>
                <th className="px-4 py-2.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 60).map((d) => {
                const s = pmState(d, today);
                return (
                  <tr
                    key={d.id}
                    onClick={() => onOpen(d.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{d.assetNo}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-800">{d.name}</div>
                      <div className="text-xs text-slate-400">
                        {d.manufacturer} {d.model}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">
                      {d.department}
                      <div className="text-xs text-slate-400">
                        {d.building} · Room {d.room}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-600 md:table-cell">{d.engineer}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                      {formatDate(d.nextDue)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={s.tone}>
                          {s.label}
                          {s.remaining < 0 ? ` ${-s.remaining}d` : ""}
                        </Badge>
                        {d.opStatus !== "Operational" && <Badge tone="amber">{d.opStatus}</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rows.length > 60 && (
          <div className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
            Showing the first 60 of {rows.length} matching rows. Pagination comes with the real API.
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceDetail({ device, today, perms, onBack, onRecord, onReport }) {
  const s = pmState(device, today);
  const grace = graceDays(device.intervalDays);
  const totalCost = device.history.reduce((sum, h) => sum + (h.cost || 0), 0);
  const totalDowntime = device.history.reduce((sum, h) => sum + (h.downtime || 0), 0);

  return (
    <div className="mx-auto max-w-5xl">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> All equipment
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-medium text-slate-900">{device.name}</h1>
            <Badge tone={device.criticality === "Critical" ? "rose" : "slate"}>
              {device.criticality}
            </Badge>
          </div>
          <div className="mt-1 font-mono text-xs text-slate-500">
            {device.id} · Asset {device.assetNo} · Serial {device.serial}
          </div>
        </div>
        <div className="flex gap-2">
          {perms.canReport && (
            <button
              onClick={onReport}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-rose-300 hover:text-rose-700"
            >
              Report a problem
            </button>
          )}
          {perms.canRecord && (
            <button
              onClick={onRecord}
              className="flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              <Wrench size={15} /> Record maintenance
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-4 text-sm font-medium text-slate-800">Overview</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Manufacturer">{device.manufacturer}</Field>
              <Field label="Model" mono>{device.model}</Field>
              <Field label="Operational status">
                <Badge tone={device.opStatus === "Operational" ? "emerald" : "amber"}>
                  {device.opStatus}
                </Badge>
              </Field>
              <Field label="Department">{device.department}</Field>
              <Field label="Location">
                {device.building}, floor {device.floor}, room {device.room}
              </Field>
              <Field label="Responsible engineer">{device.engineer}</Field>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <header className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-800">Maintenance history</h2>
            </header>
            <ul className="divide-y divide-slate-100">
              {device.history.map((h, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{formatDate(h.date)}</span>
                    <Badge tone="teal">{h.type}</Badge>
                    {h.rebased && <Badge tone="amber">Schedule re-based</Badge>}
                    <span className="ml-auto text-xs text-slate-400">{h.engineer}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-700">{h.work}</p>
                  {perms.canSeeCost && (
                    <div className="mt-1 font-mono text-xs text-slate-400">
                      ${h.cost.toLocaleString()} · {h.downtime}h downtime
                      {typeof h.lateness === "number" && h.lateness > 0 && ` · ${h.lateness}d late`}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800">
              <CalendarClock size={15} className="text-teal-700" /> Preventive maintenance
            </h2>
            <div className="mb-3 flex items-baseline gap-2">
              <Badge tone={s.tone}>{s.label}</Badge>
              <span className="font-mono text-sm text-slate-600">
                {s.remaining < 0 ? `${-s.remaining} days late` : `in ${s.remaining} days`}
              </span>
            </div>
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <Field label="Next due" mono>{formatDate(device.nextDue)}</Field>
              <Field label="Last completed" mono>{formatDate(device.lastCompleted)}</Field>
              <Field label="Interval" mono>{device.intervalDays} days</Field>
              <Field label="Interval source">{device.intervalSource}</Field>
              <Field label="Schedule rule">
                {device.scheduleMode === "anchored"
                  ? "Fixed calendar anchor"
                  : `Anchored, ${grace}-day grace window`}
              </Field>
            </div>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
              {device.scheduleMode === "anchored"
                ? "The due date always advances by one interval from the previous due date, whenever the work is done."
                : `Work completed within ${grace} days of the due date keeps the original schedule. Later than that and the schedule re-bases onto the completion date, and the re-base is recorded.`}
            </p>
          </div>

          {perms.canSeeCost && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-medium text-slate-800">Lifetime totals</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Service cost" mono>${totalCost.toLocaleString()}</Field>
                <Field label="Downtime" mono>{totalDowntime}h</Field>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                MTBF and MTTR need more history than the prototype carries. They arrive with the
                repair-ticket module.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NotificationCentre({ items, onOpen, onMarkAll }) {
  const levelTone = { info: "sky", warning: "amber", urgent: "amber", due: "amber", overdue: "rose" };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every reminder the scheduler has sent, newest first.
          </p>
        </div>
        {items.length > 0 && (
          <button onClick={onMarkAll} className="text-sm text-teal-700 hover:text-teal-900">
            Mark all as read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <Bell size={20} className="mx-auto text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">No notifications yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Advance the system date at the top of the screen. The scheduler runs for each day that
            passes and reminders appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {items.map((n) => (
            <li key={n.key}>
              <button
                onClick={() => onOpen(n.deviceId)}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:border-slate-300 ${
                  n.read ? "border-slate-200 bg-white" : "border-slate-200 bg-white"
                }`}
              >
                <Badge tone={levelTone[n.level] || "slate"}>{n.level}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800">
                    {n.deviceName}{" "}
                    <span className="font-mono text-xs text-slate-400">{n.assetNo}</span>
                  </div>
                  <div className="text-sm text-slate-600">{n.message}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Sent {formatDate(n.date)} to {n.recipient}
                  </div>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordDialog({ device, today, onClose, onSave }) {
  const [form, setForm] = useState({
    type: "Preventive maintenance",
    date: today,
    engineer: device.engineer,
    work: "",
    cost: "",
    downtime: "",
  });
  const [error, setError] = useState("");

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    if (error) setError("");
  };

  const preview = recalculateDue({
    scheduleMode: device.scheduleMode,
    previousDue: device.nextDue,
    completedOn: form.date,
    intervalDays: device.intervalDays,
  });

  const submit = () => {
    if (!form.work.trim()) {
      setError("Describe the work performed before saving.");
      return;
    }
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="mt-8 w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-slate-900">Record maintenance</h2>
            <p className="font-mono text-xs text-slate-500">
              {device.name} · {device.assetNo}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">Type</span>
              <select
                value={form.type}
                onChange={set("type")}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
              >
                {["Preventive maintenance", "Corrective maintenance", "Inspection", "Safety testing"].map(
                  (t) => (
                    <option key={t}>{t}</option>
                  )
                )}
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">Completed on</span>
              <input
                type="date"
                value={form.date}
                onChange={set("date")}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Work performed</span>
            <textarea
              value={form.work}
              onChange={set("work")}
              rows={3}
              placeholder="Checks carried out, measurements taken, parts replaced"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-teal-500"
            />
          </label>
          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">Cost ($)</span>
              <input
                type="number"
                value={form.cost}
                onChange={set("cost")}
                placeholder="0"
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">Downtime (hours)</span>
              <input
                type="number"
                value={form.downtime}
                onChange={set("downtime")}
                placeholder="0"
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
              />
            </label>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Next due date</div>
            <div className="mt-1 font-mono text-sm text-slate-900">{formatDate(preview.nextDue)}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              {device.scheduleMode === "anchored"
                ? "Fixed anchor: one interval on from the previous due date."
                : preview.rebased
                ? `${preview.lateness} days late, past the ${graceDays(
                    device.intervalDays
                  )}-day grace window, so the schedule re-bases onto the completion date.`
                : `Within the ${graceDays(device.intervalDays)}-day grace window, so the original schedule is kept.`}
            </p>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Save record
          </button>
        </footer>
      </div>
    </div>
  );
}
