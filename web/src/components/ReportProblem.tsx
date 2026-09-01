/**
 * Reporting a fault, from wherever the device already is on screen.
 *
 * Deliberately short. It is filled in by someone standing next to a
 * broken machine with a patient nearby, so it asks for the two things
 * only they can supply — what is wrong, and how urgent it is — and takes
 * everything else from the device.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, PRIORITIES, PRIORITY_LABELS, type Alert } from "../lib/api";
import { Button } from "./ui";

const PRIORITY_HELP: Record<string, string> = {
  EMERGENCY: "In use now, or needed for a patient immediately.",
  MEDIUM: "Needs attention, but the ward can work around it.",
  LOW: "Can wait until somebody is free.",
};

export function ReportProblem({
  equipmentId,
  deviceName,
  onClose,
}: {
  equipmentId: string;
  deviceName: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<{ id: string; number: string } | null>(null);

  const raise = useMutation({
    mutationFn: () =>
      api.post<Alert>("/api/alerts", { equipmentId, description, priority }),
    onSuccess: (alert) => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // Someone else has already reported this device. Say so rather than
      // navigating away — the reporter may want to read the existing one.
      if (alert.duplicateOf) {
        setDuplicate(alert.duplicateOf);
        return;
      }
      navigate(`/alerts/${alert.id}`);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not send the report."),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="mt-8 w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-900">Report a problem</h2>
          <p className="font-mono text-xs text-slate-500">{deviceName}</p>
        </header>

        {duplicate ? (
          <div className="p-4">
            <p className="text-sm leading-relaxed text-slate-700">
              Your report has been sent. Note that this device already had an open alert,{" "}
              <span className="font-mono text-xs">{duplicate.number}</span> — biomedical
              engineering will see both.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => navigate(`/alerts/${duplicate.id}`)}>
                See the existing alert
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-slate-500">
                  What is wrong?
                </span>
                <textarea
                  rows={4}
                  autoFocus
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What you saw, what it was doing, any alarm or error shown"
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-teal-500"
                />
              </label>

              <fieldset>
                <legend className="text-xs uppercase tracking-wide text-slate-500">
                  How urgent?
                </legend>
                <div className="mt-1 space-y-1.5">
                  {PRIORITIES.map((p) => (
                    <label
                      key={p}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 transition ${
                        priority === p
                          ? "border-teal-400 bg-teal-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="priority"
                        className="mt-1"
                        checked={priority === p}
                        onChange={() => setPriority(p)}
                      />
                      <span>
                        <span className="block text-sm text-slate-800">{PRIORITY_LABELS[p]}</span>
                        <span className="block text-xs text-slate-500">{PRIORITY_HELP[p]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>

            <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!description.trim() || raise.isPending}
                onClick={() => raise.mutate()}
              >
                {raise.isPending ? "Sending…" : "Send report"}
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
