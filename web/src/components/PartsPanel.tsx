/**
 * Parts on a work order.
 *
 * One button per line, labelled with what it does rather than where it
 * lands — "Mark ordered", not "→ ORDERED" — because the person clicking
 * it is recording something that just happened, not navigating a state
 * machine.
 *
 * Read-only for everyone but the engineer holding the job, and for
 * everyone once the work order closes. The server enforces both; this
 * only avoids offering buttons that would be refused.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  formatDate,
  isPartOutstanding,
  NEXT_PART_STATUS,
  PART_ADVANCE_LABELS,
  PART_STATUS_LABELS,
  partTone,
  type WorkOrderPart,
} from "../lib/api";
import { Badge, Button, Card } from "./ui";

export function PartsPanel({
  workOrderId,
  parts,
  editable,
}: {
  workOrderId: string;
  parts: WorkOrderPart[];
  editable: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => {
    setError("");
    setAdding(false);
    qc.invalidateQueries({ queryKey: ["work-order", workOrderId] });
    qc.invalidateQueries({ queryKey: ["alert"] });
  };
  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "That did not work.");

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/api/work-orders/${workOrderId}/parts/${id}`, { status }),
    onSuccess: refresh,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/work-orders/${workOrderId}/parts/${id}`),
    onSuccess: refresh,
    onError: fail,
  });

  const outstanding = parts.filter((p) => isPartOutstanding(p.status)).length;

  return (
    <Card>
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-slate-800">Parts ({parts.length})</h2>
          {outstanding > 0 && (
            <p className="text-xs text-amber-700">
              {outstanding} still outstanding — the work order cannot close until each is
              installed or cancelled.
            </p>
          )}
        </div>
        {editable && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900"
          >
            <Plus size={14} /> Add a part
          </button>
        )}
      </header>

      {error && <div className="px-4 pt-3 text-sm text-rose-600">{error}</div>}

      {adding && (
        <AddPart
          workOrderId={workOrderId}
          onDone={refresh}
          onCancel={() => setAdding(false)}
          onError={fail}
        />
      )}

      {parts.length === 0 && !adding ? (
        <div className="p-6 text-sm text-slate-500">
          No parts recorded. {editable ? "Add one if the repair needs it." : ""}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {parts.map((part) => {
            const next = NEXT_PART_STATUS[part.status];
            return (
              <li key={part.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={partTone(part.status)}>{PART_STATUS_LABELS[part.status]}</Badge>
                  <span className="text-sm text-slate-800">
                    {part.name}
                    {part.quantity > 1 ? ` ×${part.quantity}` : ""}
                  </span>
                  {part.partNumber && (
                    <span className="font-mono text-xs text-slate-400">{part.partNumber}</span>
                  )}

                  {editable && (
                    <span className="ml-auto flex items-center gap-2">
                      {next && (
                        <Button
                          variant="ghost"
                          disabled={advance.isPending}
                          onClick={() => advance.mutate({ id: part.id, status: next })}
                        >
                          {PART_ADVANCE_LABELS[part.status]}
                        </Button>
                      )}
                      {isPartOutstanding(part.status) &&
                        (part.status === "REQUIRED" ? (
                          <button
                            title="Remove this line"
                            onClick={() => remove.mutate(part.id)}
                            className="cursor-pointer text-slate-400 hover:text-rose-700"
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              advance.mutate({ id: part.id, status: "CANCELLED" })
                            }
                            className="cursor-pointer text-xs text-slate-500 hover:text-rose-700"
                          >
                            Cancel
                          </button>
                        ))}
                    </span>
                  )}
                </div>

                <PartTrail part={part} />
                {part.notes && <p className="mt-1 text-xs text-slate-500">{part.notes}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * When each rung was reached.
 *
 * "Ordered three weeks ago" is the question a stalled repair always
 * raises, so the dates are on the row rather than buried in the audit log.
 */
function PartTrail({ part }: { part: WorkOrderPart }) {
  const steps = [
    ["Requested", part.requestedAt],
    ["Ordered", part.orderedAt],
    ["Received", part.receivedAt],
    ["Installed", part.installedAt],
    ["Cancelled", part.cancelledAt],
  ].filter(([, at]) => at) as [string, string][];

  if (steps.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
      {steps.map(([label, at]) => (
        <span key={label}>
          {label} {formatDate(at)}
        </span>
      ))}
    </div>
  );
}

function AddPart({
  workOrderId,
  onDone,
  onCancel,
  onError,
}: {
  workOrderId: string;
  onDone: () => void;
  onCancel: () => void;
  onError: (err: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [quantity, setQuantity] = useState("1");

  const add = useMutation({
    mutationFn: () =>
      api.post(`/api/work-orders/${workOrderId}/parts`, {
        name,
        ...(partNumber ? { partNumber } : {}),
        quantity: Number(quantity) || 1,
      }),
    onSuccess: onDone,
    onError,
  });

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Part name"
          className="min-w-40 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500"
        />
        <input
          value={partNumber}
          onChange={(e) => setPartNumber(e.target.value)}
          placeholder="Part number"
          className="w-32 rounded-md border border-slate-200 px-2 py-1.5 font-mono text-sm outline-none focus:border-teal-500"
        />
        <input
          type="number"
          min="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-20 rounded-md border border-slate-200 px-2 py-1.5 font-mono text-sm"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Adding…" : "Add part"}
        </Button>
      </div>
    </div>
  );
}
