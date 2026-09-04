/**
 * One alert, and whatever the viewer is allowed to do with it.
 *
 * The actions shown are the actions that role can take: a nurse sees
 * progress, the head of alerts sees Acknowledge then Assign, the engineer
 * sees the work order. Every one of them is enforced again on the server —
 * hiding a button is a courtesy, not a permission.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  ALERT_STATUS_LABELS,
  alertStatusTone,
  api,
  ApiError,
  formatDate,
  PRIORITY_LABELS,
  PART_STATUS_LABELS,
  partTone,
  priorityTone,
  triagesAlerts,
  WORK_ORDER_STATUS_LABELS,
  type Alert,
  type AuditEntry,
  type WorkOrder,
} from "../lib/api";
import { Badge, Button, Card, ErrorNote, Field, Spinner, Timeline } from "../components/ui";
import { AuditDiff } from "./Activity";
import { useAuth } from "../auth";

export function AlertDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState("");

  const query = useQuery({
    queryKey: ["alert", id],
    queryFn: () => api.get<Alert>(`/api/alerts/${id}`),
  });

  const history = useQuery({
    queryKey: ["alert-audit", id],
    queryFn: () => api.get<{ rows: AuditEntry[] }>(`/api/alerts/${id}/audit`),
  });

  const refresh = () => {
    setError("");
    qc.invalidateQueries({ queryKey: ["alert", id] });
    qc.invalidateQueries({ queryKey: ["alert-audit", id] });
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "That did not work.");

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/api/alerts/${id}/acknowledge`),
    onSuccess: refresh,
    onError: fail,
  });

  const assign = useMutation({
    mutationFn: (engineerId: string) => api.post(`/api/alerts/${id}/assign`, { engineerId }),
    onSuccess: refresh,
    onError: fail,
  });

  const openWorkOrder = useMutation({
    mutationFn: () => api.post<WorkOrder>("/api/work-orders", { alertId: id }),
    onSuccess: refresh,
    onError: fail,
  });

  // Only fetched when it can be used, so a nurse's page makes no call
  // that would 403.
  const engineers = useQuery({
    queryKey: ["assignable-engineers"],
    queryFn: () =>
      api.get<{ engineers: { id: string; fullName: string }[] }>("/api/alerts/meta/engineers"),
    enabled: triagesAlerts(user?.role),
  });

  if (query.isLoading) return <Spinner label="Loading alert" />;
  if (query.isError) return <ErrorNote message="That alert could not be found." />;

  const alert = query.data!;
  const canTriage = triagesAlerts(user?.role);
  const isAssignedEngineer = user?.id === alert.assignedTo?.id;
  const canOpenWorkOrder =
    !alert.workOrder && alert.status === "ASSIGNED" && (isAssignedEngineer || user?.role === "ADMIN");

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/alerts"
        className="mb-4 flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> All alerts
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium text-slate-900">{alert.equipment.name}</h1>
            <Badge tone={priorityTone(alert.priority)}>{PRIORITY_LABELS[alert.priority]}</Badge>
            <Badge tone={alertStatusTone(alert.status)}>{ALERT_STATUS_LABELS[alert.status]}</Badge>
          </div>
          <div className="mt-1 font-mono text-xs text-slate-500">
            {alert.number} · Asset {alert.equipment.assetNo}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canTriage && alert.status === "OPEN" && (
            <Button onClick={() => acknowledge.mutate()} disabled={acknowledge.isPending}>
              {acknowledge.isPending ? "Confirming…" : "Confirm receipt"}
            </Button>
          )}
          {canOpenWorkOrder && (
            <Button onClick={() => openWorkOrder.mutate()} disabled={openWorkOrder.isPending}>
              {openWorkOrder.isPending ? "Opening…" : "Start work order"}
            </Button>
          )}
          {alert.workOrder && (
            <Link
              to={`/work-orders/${alert.workOrder.id}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
            >
              Open work order
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="space-y-5 lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Reported problem</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {alert.description}
            </p>
          </Card>

          {canTriage && alert.status === "ACKNOWLEDGED" && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-medium text-slate-800">Assign an engineer</h2>
              <select
                defaultValue=""
                onChange={(e) => e.target.value && assign.mutate(e.target.value)}
                disabled={assign.isPending}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Choose an engineer…</option>
                {engineers.data?.engineers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </Card>
          )}

          <Card>
            <header className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-800">History</h2>
            </header>
            {history.isLoading ? (
              <Spinner />
            ) : (history.data?.rows.length ?? 0) === 0 ? (
              <div className="p-6 text-sm text-slate-500">Nothing recorded yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {history.data!.rows.map((entry) => (
                  <li key={entry.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="slate">{entry.action.replace(/^\w+\./, "").replace(/_/g, " ")}</Badge>
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
        </section>

        <aside className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Progress</h2>
            {/* Times rather than dates: an alert can be reported, received
                and assigned inside one morning, and four identical dates
                say nothing about the order it went in. */}
            <Timeline
              steps={[
                { label: "Reported", at: alert.openedAt, by: alert.raisedBy.fullName },
                {
                  label: "Received",
                  at: alert.acknowledgedAt,
                  by: alert.acknowledgedBy?.fullName,
                },
                { label: "Assigned", at: alert.assignedAt, by: alert.assignedTo?.fullName },
                { label: "Work order raised", at: alert.workOrder?.createdAt ?? null },
                { label: "Resolved", at: alert.resolvedAt },
              ]}
            />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-slate-800">Device</h2>
            <div className="space-y-3">
              <Field label="Equipment">
                <Link
                  to={`/equipment/${alert.equipment.id}`}
                  className="text-teal-800 hover:underline"
                >
                  {alert.equipment.name}
                </Link>
              </Field>
              <Field label="Location">
                {alert.equipment.department.name}
                {alert.equipment.room ? `, room ${alert.equipment.room.code}` : ""}
              </Field>
              {alert.workOrder && (
                <Field label="Work order">
                  {WORK_ORDER_STATUS_LABELS[alert.workOrder.status]}
                </Field>
              )}
              {/* Why the repair is taking time, for the person waiting. */}
              {alert.workOrder && alert.workOrder.parts.length > 0 && (
                <Field label="Parts">
                  <ul className="space-y-1">
                    {alert.workOrder.parts.map((part) => (
                      <li key={part.id} className="flex items-center gap-2">
                        <Badge tone={partTone(part.status)}>
                          {PART_STATUS_LABELS[part.status]}
                        </Badge>
                        <span className="truncate text-sm">
                          {part.name}
                          {part.quantity > 1 ? ` ×${part.quantity}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

