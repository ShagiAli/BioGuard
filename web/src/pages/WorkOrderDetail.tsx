/**
 * A work order: what the engineer found, what they did, and the close.
 *
 * Closing is the consequential action here — it returns the device to
 * service and writes the repair into the device's permanent history — so
 * it asks for the repair and the outcome in words rather than being a
 * single button.
 *
 * Once closed the form disappears for everyone but an administrator, and
 * an administrator's edit is recorded under its own audit action.
 */
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import {
  api,
  ApiError,
  formatDate,
  PRIORITY_LABELS,
  priorityTone,
  WORK_ORDER_STATUS_LABELS,
  type WorkOrder,
  type WorkOrderStatus,
} from "../lib/api";
import { Badge, Button, Card, ErrorNote, Field, Spinner, Timeline, Tabs } from "../components/ui";
import { Notes } from "../components/Notes";
import { useAuth } from "../auth";
import { PartsPanel } from "../components/PartsPanel";

/** The states an engineer moves through by hand; CLOSED has its own form. */
const LIVE_STATUSES: WorkOrderStatus[] = [
  "INVESTIGATING",
  "AWAITING_PARTS",
  "IN_REPAIR",
  "COMPLETED",
];

type WorkOrderTab = "work" | "parts" | "notes";

export function WorkOrderDetail() {
  const [tabParams, setTabParams] = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);

  const query = useQuery({
    queryKey: ["work-order", id],
    queryFn: () => api.get<WorkOrder>(`/api/work-orders/${id}`),
  });

  const refresh = () => {
    setError("");
    setClosing(false);
    qc.invalidateQueries({ queryKey: ["work-order", id] });
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["alert"] });
    qc.invalidateQueries({ queryKey: ["equipment"] });
  };

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "That did not work.");

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/work-orders/${id}`, body),
    onSuccess: refresh,
    onError: fail,
  });

  const close = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/work-orders/${id}/close`, body),
    onSuccess: refresh,
    onError: fail,
  });

  if (query.isLoading) return <Spinner label="Loading work order" />;
  if (query.isError) return <ErrorNote message="That work order could not be found." />;

  const wo = query.data!;

  /** In the URL, so one view of one repair can be sent to somebody. */
  const tab = (tabParams.get("tab") ?? "work") as WorkOrderTab;
  const setTab = (key: WorkOrderTab) => {
    const next = new URLSearchParams(tabParams);
    if (key === "work") next.delete("tab");
    else next.set("tab", key);
    setTabParams(next, { replace: true });
  };

  /**
   * When this repair first started waiting on somebody else.
   *
   * The earliest order across the parts, because that is the moment the
   * job stopped being about an engineer's time and started being about a
   * supplier's — which is the question people ask of a stalled repair.
   */
  const partsOrderedAt =
    wo.parts
      .map((part) => part.orderedAt)
      .filter((at): at is string => at !== null)
      .sort()[0] ?? null;
  const isClosed = wo.status === "CLOSED";
  const canEdit = !isClosed || user?.role === "ADMIN";
  const canClose = !isClosed && wo.status === "COMPLETED";

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to={`/alerts/${wo.alert.id}`}
        className="mb-4 flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> Back to the alert
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium text-slate-900">{wo.equipment.name}</h1>
            <Badge tone={priorityTone(wo.priority)}>{PRIORITY_LABELS[wo.priority]}</Badge>
            <Badge tone={isClosed ? "emerald" : "sky"}>
              {WORK_ORDER_STATUS_LABELS[wo.status]}
            </Badge>
          </div>
          <div className="mt-1 font-mono text-xs text-slate-500">
            {wo.number} · Asset {wo.equipment.assetNo} · Engineer {wo.engineer.fullName}
          </div>
        </div>

        {canClose && (
          <Button onClick={() => setClosing(true)}>Complete and close</Button>
        )}
      </div>

      {isClosed && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <Lock size={15} className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            Closed {formatDate(wo.closedAt)}
            {wo.closedBy ? ` by ${wo.closedBy.fullName}` : ""}.{" "}
            {user?.role === "ADMIN"
              ? "As an administrator you can still amend it; the change is recorded."
              : "Closed work orders are read-only."}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="space-y-5 lg:col-span-2">
          {/* The repair's own record, split the way the design splits it:
              what was found, what it needed, and what was said about it.
              Parts get a tab of their own because a stalled repair is
              usually stalled on one, and it should not be scrolled past. */}
          <Tabs
            tabs={[
              { key: "work", label: "Work details" },
              { key: "parts", label: "Parts", count: wo.parts.length },
              { key: "notes", label: "Notes" },
            ]}
            current={tab}
            onChange={setTab}
          />

          {tab === "work" && (
            <>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Reported problem</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {wo.alert.description}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Reported by {wo.alert.raisedBy.fullName}
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Investigation</h2>
            <div className="space-y-3">
              <TextArea
                label="Findings"
                value={wo.findings}
                disabled={!canEdit || update.isPending}
                onSave={(findings) => update.mutate({ findings })}
              />
              <TextArea
                label="Diagnosis"
                value={wo.diagnosis}
                disabled={!canEdit || update.isPending}
                onSave={(diagnosis) => update.mutate({ diagnosis })}
              />
              <TextArea
                label="Repair actions"
                value={wo.repairActions}
                disabled={!canEdit || update.isPending}
                onSave={(repairActions) => update.mutate({ repairActions })}
              />
            </div>
          </Card>

          {wo.finalResolution && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-medium text-slate-800">Final resolution</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {wo.finalResolution}
              </p>
            </Card>
          )}
            </>
          )}

          {tab === "parts" && (
            <PartsPanel
              workOrderId={wo.id}
              parts={wo.parts}
              editable={canEdit && (user?.id === wo.engineer.id || user?.role === "ADMIN")}
            />
          )}

          {tab === "notes" && <Notes basePath={`/api/work-orders/${wo.id}`} />}

        </section>

        <aside className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Progress</h2>
            {/* The repair's own clock. Everything that happened before an
                engineer picked this up belongs to the alert, which has its
                own timeline. */}
            <Timeline
              steps={[
                { label: "Raised", at: wo.createdAt, by: wo.engineer.fullName },
                {
                  label: "Parts ordered",
                  at: partsOrderedAt,
                  detail:
                    wo.parts.length > 0
                      ? `${wo.parts.length} part${wo.parts.length === 1 ? "" : "s"} on this repair`
                      : undefined,
                },
                { label: "Work completed", at: wo.completedAt },
                { label: "Closed", at: wo.closedAt, by: wo.closedBy?.fullName },
              ]}
            />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Status</h2>
            {isClosed ? (
              <Badge tone="emerald">Closed</Badge>
            ) : (
              <select
                value={wo.status}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ status: e.target.value })}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
              >
                {LIVE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {WORK_ORDER_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              The device shows this status on the equipment list, so it stays accurate without
              anyone updating it separately.
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Details</h2>
            <div className="space-y-3">
              <Field label="Opened" mono>
                {formatDate(wo.createdAt)}
              </Field>
              <Field label="Completed" mono>
                {formatDate(wo.completedAt)}
              </Field>
              <Field label="Device status">
                {wo.equipment.operationalStatus.toLowerCase().replace(/_/g, " ")}
              </Field>
            </div>
          </Card>
        </aside>
      </div>

      {closing && (
        <CloseDialog
          busy={close.isPending}
          onCancel={() => setClosing(false)}
          onConfirm={(body) => close.mutate(body)}
        />
      )}
    </div>
  );
}

/** Edit in place: shows the current text, saves when it changes. */
function TextArea({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <textarea
        rows={3}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value ?? "") && onSave(draft)}
        placeholder={disabled ? "—" : "Not recorded yet"}
        className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </label>
  );
}

function CloseDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (body: Record<string, unknown>) => void;
}) {
  const [repairActions, setRepairActions] = useState("");
  const [finalResolution, setFinalResolution] = useState("");
  const [cost, setCost] = useState("");
  const [downtimeHours, setDowntimeHours] = useState("0");
  const [labourHours, setLabourHours] = useState("");

  const ready = repairActions.trim() && finalResolution.trim();

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="mt-8 w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-900">Close the work order</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            This returns the device to service and writes the repair into its permanent history.
          </p>
        </header>

        <div className="space-y-3 p-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Repair carried out</span>
            <textarea
              rows={3}
              value={repairActions}
              onChange={(e) => setRepairActions(e.target.value)}
              placeholder="Parts replaced, adjustments made, tests performed"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-teal-500"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Final resolution</span>
            <textarea
              rows={2}
              value={finalResolution}
              onChange={(e) => setFinalResolution(e.target.value)}
              placeholder="Outcome, and anything the ward should know"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-teal-500"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">Cost ($)</span>
              <input
                type="number"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                Downtime (hours)
              </span>
              <input
                type="number"
                min="0"
                value={downtimeHours}
                onChange={(e) => setDowntimeHours(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                Labour (hours)
              </span>
              <input
                type="number"
                min="0"
                step="0.25"
                value={labourHours}
                onChange={(e) => setLabourHours(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 font-mono text-sm"
              />
              {/* Not the same as downtime: an hour of work can sit inside
                  three weeks of waiting for a part. */}
              <span className="mt-1 block text-xs text-slate-400">Engineer time, not downtime.</span>
            </label>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={() =>
              onConfirm({
                repairActions,
                finalResolution,
                ...(cost ? { cost: Number(cost) } : {}),
                ...(labourHours ? { labourHours: Number(labourHours) } : {}),
                downtimeHours: Number(downtimeHours) || 0,
              })
            }
          >
            {busy ? "Closing…" : "Close work order"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
