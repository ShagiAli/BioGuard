import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, QrCode, Siren, Wrench, X } from "lucide-react";
import {
  api,
  ApiError,
  AUDIT_ACTION_LABELS,
  canSeeCosts,
  MAINTENANCE_TYPES,
  daysUntil,
  formatDate,
  formatMoney,
  PM_LABELS,
  STATUS_LABELS,
  titleCase,
  type AuditEntry,
  type EquipmentDetail as Detail,
} from "../lib/api";
import { Badge, Button, Card, ErrorNote, Field, Spinner, pmTone , Tabs } from "../components/ui";
import { AuditDiff } from "./Activity";
import { ReportProblem } from "../components/ReportProblem";
import { useAuth } from "../auth";

type EquipmentTab = "overview" | "maintenance" | "changes";

export function EquipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const canRecord = user?.role === "ADMIN" || user?.role === "ENGINEER";

  /**
   * The open tab lives in the URL for the same reason the equipment
   * filters do: it makes one view of one device something you can send
   * to a colleague, and it keeps the back button stepping through what
   * was actually looked at.
   *
   * There is no Files tab. The design has one; the application has
   * nowhere to put a file yet, and a tab that opens onto an apology is
   * worse than a tab that is not there.
   */
  const [tabParams, setTabParams] = useSearchParams();
  const tab = (tabParams.get("tab") ?? "overview") as EquipmentTab;
  const setTab = (key: EquipmentTab) => {
    const next = new URLSearchParams(tabParams);
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    setTabParams(next, { replace: true });
  };
  const canSeeCost = canSeeCosts(user?.role);

  const query = useQuery({
    queryKey: ["equipment", id],
    queryFn: () => api.get<Detail>(`/api/equipment/${id}`),
  });

  if (query.isLoading) return <Spinner label="Loading device" />;
  if (query.isError) return <ErrorNote message="That device could not be found." />;

  const d = query.data!;
  const remaining = daysUntil(d.nextDueAt);
  // Served by the API from the same function the scheduler uses.
  const grace = d.graceWindow;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/equipment"
        className="mb-4 flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> All equipment
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-medium text-slate-900">{d.name}</h1>
            <Badge tone={d.criticality === "CRITICAL" ? "rose" : "slate"}>
              {titleCase(d.criticality)}
            </Badge>
          </div>
          <div className="mt-1 font-mono text-xs text-slate-500">
            {d.tag} · Asset {d.assetNo} · Serial {d.serialNo}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowQr(true)}>
            <span className="flex items-center gap-1.5">
              <QrCode size={15} /> QR label
            </span>
          </Button>
          {/* Anyone who can see the device can report a fault on it. */}
          <Button variant="danger" onClick={() => setReporting(true)}>
            <span className="flex items-center gap-1.5">
              <Siren size={15} /> Report a problem
            </span>
          </Button>
          {canRecord && (
            <Button onClick={() => setRecording(true)}>
              <span className="flex items-center gap-1.5">
                <Wrench size={15} /> Record maintenance
              </span>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5">
        <Tabs
          tabs={[
            { key: "overview", label: "Overview" },
            { key: "maintenance", label: "Maintenance history", count: d.maintenance.length },
            { key: "changes", label: "Change history" },
          ]}
          current={tab}
          onChange={setTab}
        />
      </div>

      {tab === "overview" && (
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="space-y-5 lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-4 text-sm font-medium text-slate-800">Overview</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Category">{d.category.name}</Field>
              <Field label="Manufacturer">{d.manufacturer.name}</Field>
              <Field label="Model" mono>
                {d.model}
              </Field>
              <Field label="Operational status">
                {canRecord ? (
                  <StatusControl device={d} />
                ) : (
                  <Badge tone={d.operationalStatus === "OPERATIONAL" ? "emerald" : "amber"}>
                    {STATUS_LABELS[d.operationalStatus]}
                  </Badge>
                )}
              </Field>
              <Field label="Department">{d.department.name}</Field>
              <Field label="Location">
                {d.room
                  ? `${d.room.building.name}, floor ${d.room.floor}, room ${d.room.code}`
                  : "Not recorded"}
              </Field>
              <Field label="Responsible engineer">{d.engineer?.fullName ?? "Unassigned"}</Field>
              <Field label="Warranty ends" mono>
                {formatDate(d.warrantyEndsAt)}
              </Field>
              {canSeeCost && (
                <Field label="Purchase price" mono>
                  {formatMoney(d.purchasePrice)}
                </Field>
              )}
            </div>
          </Card>

        </section>

        <aside className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800">
              <CalendarClock size={15} className="text-teal-700" /> Preventive maintenance
            </h2>
            <div className="mb-3 flex items-baseline gap-2">
              <Badge tone={pmTone(d.pmState)}>{PM_LABELS[d.pmState]}</Badge>
              {remaining !== null && (
                <span className="font-mono text-sm text-slate-600">
                  {remaining < 0 ? `${-remaining} days late` : `in ${remaining} days`}
                </span>
              )}
            </div>
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <Field label="Next due" mono>
                {formatDate(d.nextDueAt)}
              </Field>
              <Field label="Last completed" mono>
                {formatDate(d.lastCompletedAt)}
              </Field>
              <Field label="Interval" mono>
                {d.intervalDays} days
              </Field>
              <Field label="Interval source">{titleCase(d.intervalSource)}</Field>
              <Field label="Schedule rule">
                {d.scheduleMode === "ANCHORED"
                  ? "Fixed calendar anchor"
                  : `Anchored, ${grace}-day grace window`}
              </Field>
            </div>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
              {d.scheduleMode === "ANCHORED"
                ? "The due date always advances one interval from the previous due date, whenever the work is done."
                : `Work completed within ${grace} days of the due date keeps the original schedule. Later than that, the schedule re-bases onto the completion date and the re-base is recorded.`}
            </p>
          </Card>
        </aside>
      </div>
      )}

      {tab === "maintenance" && (
        <div className="mt-5">
          <Card>
            <header className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-800">
                Maintenance history ({d.maintenance.length})
              </h2>
            </header>
            {d.maintenance.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No maintenance recorded yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.maintenance.map((h) => (
                  <li key={h.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">
                        {formatDate(h.completedOn)}
                      </span>
                      <Badge tone="teal">{titleCase(h.type)}</Badge>
                      {h.rebased && <Badge tone="amber">Schedule re-based</Badge>}
                      <span className="ml-auto text-xs text-slate-400">
                        {h.engineer?.fullName}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-700">{h.workPerformed}</p>
                    {canSeeCost && (
                      <div className="mt-1 font-mono text-xs text-slate-400">
                        {formatMoney(h.cost)} · {h.downtimeHours}h downtime
                        {h.latenessDays !== null && h.latenessDays > 0 && ` · ${h.latenessDays}d late`}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "changes" && (
        <div className="mt-5">
          <ChangeHistory deviceId={d.id} />
        </div>
      )}

      {recording && (
        <RecordDialog
          device={d}
          onClose={() => setRecording(false)}
          onDone={(message) => {
            setRecording(false);
            setToast(message);
            window.setTimeout(() => setToast(null), 6000);
          }}
        />
      )}

      {showQr && <QrDialog device={d} onClose={() => setShowQr(false)} />}

      {reporting && (
        <ReportProblem
          equipmentId={d.id}
          deviceName={`${d.name} · ${d.assetNo}`}
          onClose={() => setReporting(false)}
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

/**
 * Status editing, for the roles the API accepts it from.
 *
 * Deliberately separate from the maintenance record: taking a device out
 * of service is not the same event as servicing it, and a device can be
 * under repair *and* overdue at once. Writing status here never touches
 * the preventive schedule.
 *
 * The options come from STATUS_LABELS so this list cannot drift from the
 * enum the server validates against.
 */
function StatusControl({ device }: { device: Detail }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (operationalStatus: string) =>
      api.patch(`/api/equipment/${device.id}/status`, { operationalStatus }),
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["equipment"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["attention"] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not change the status."),
  });

  return (
    <div>
      <select
        value={device.operationalStatus}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.value)}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 disabled:opacity-50"
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function QrDialog({ device, onClose }: { device: Detail; onClose: () => void }) {
  return (
    <Overlay onClose={onClose} title="QR label" subtitle={`${device.name} · ${device.assetNo}`}>
      <div className="p-4 text-center">
        <img
          src={`/api/equipment/${device.id}/qr`}
          alt={`QR code for ${device.assetNo}`}
          className="mx-auto h-56 w-56 rounded border border-slate-200"
        />
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Print and fix to the device. Scanning opens a minimal status page — the code carries an
          opaque token, not the asset number, so labels cannot be used to enumerate the estate.
        </p>
      </div>
    </Overlay>
  );
}

function RecordDialog({
  device,
  onClose,
  onDone,
}: {
  device: Detail;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    type: "PREVENTIVE",
    completedOn: today,
    workPerformed: "",
    findings: "",
    cost: "",
    downtimeHours: "0",
  });
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.post<{ nextDueAt: string; schedule: { rebased: boolean; latenessDays: number | null; graceWindow: number } | null }>(
        "/api/maintenance",
        {
          equipmentId: device.id,
          type: form.type,
          completedOn: form.completedOn,
          workPerformed: form.workPerformed,
          findings: form.findings || undefined,
          cost: form.cost ? Number(form.cost) : undefined,
          downtimeHours: Number(form.downtimeHours) || 0,
        }
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["equipment"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["attention"] });

      if (!data.schedule) {
        onDone("Recorded. Corrective work does not move the preventive maintenance date.");
      } else if (data.schedule.rebased) {
        onDone(
          `Recorded. ${data.schedule.latenessDays} days late, past the ${data.schedule.graceWindow}-day grace window, so the schedule re-based onto the completion date.`
        );
      } else {
        onDone("Recorded. Within the grace window, so the original schedule is kept.");
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save."),
  });

  const submit = () => {
    if (!form.workPerformed.trim()) {
      setError("Describe the work performed before saving.");
      return;
    }
    setError("");
    save.mutate();
  };

  return (
    <Overlay
      onClose={onClose}
      title="Record maintenance"
      subtitle={`${device.name} · ${device.assetNo}`}
    >
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Type</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
            >
              {MAINTENANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Completed on</span>
            <input
              type="date"
              max={today}
              value={form.completedOn}
              onChange={(e) => setForm({ ...form, completedOn: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">Work performed</span>
          <textarea
            rows={3}
            value={form.workPerformed}
            onChange={(e) => setForm({ ...form, workPerformed: e.target.value })}
            placeholder="Checks carried out, measurements taken, parts replaced"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-teal-500"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Cost ($)</span>
            <input
              type="number"
              min="0"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Downtime (hours)</span>
            <input
              type="number"
              min="0"
              value={form.downtimeHours}
              onChange={(e) => setForm({ ...form, downtimeHours: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
            />
          </label>
        </div>

        {form.type !== "PREVENTIVE" && (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Only preventive maintenance resets the schedule. This record keeps the current due date
            of {formatDate(device.nextDueAt)}.
          </p>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>

      <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save record"}
        </Button>
      </footer>
    </Overlay>
  );
}

function Overlay({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="mt-8 w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-slate-900">{title}</h2>
            <p className="font-mono text-xs text-slate-500">{subtitle}</p>
          </div>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * What has been changed on this device, and by whom.
 *
 * Scoped rather than admin-only: the engineer responsible for a device
 * is exactly the person who needs to see that somebody else took it out
 * of service. The API resolves the device through the usual equipment
 * scope first, so an out-of-scope id is a 404 before any audit row is
 * read.
 */
function ChangeHistory({ deviceId }: { deviceId: string }) {
  const query = useQuery({
    queryKey: ["equipment-audit", deviceId],
    queryFn: () => api.get<{ rows: AuditEntry[] }>(`/api/equipment/${deviceId}/audit`),
  });

  const rows = query.data?.rows ?? [];

  return (
    <Card>
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-medium text-slate-800">Change history ({rows.length})</h2>
      </header>

      {query.isLoading ? (
        <Spinner label="Loading history" />
      ) : query.isError ? (
        <div className="p-4">
          <ErrorNote message="Could not load the change history." />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-sm text-slate-500">
          No changes recorded yet. Status edits and maintenance appear here.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={entry.action === "maintenance.recorded_rebased" ? "amber" : "slate"}>
                  {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                </Badge>
                <span className="ml-auto text-xs text-slate-400">
                  {formatDate(entry.createdAt)}
                  {entry.actor ? ` · ${entry.actor.fullName}` : ""}
                </span>
              </div>
              <AuditDiff entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
