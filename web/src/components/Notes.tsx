/**
 * The conversation around a fault or a repair.
 *
 * One component for both, taking the path it hangs off, because the two
 * threads behave identically and two copies would drift.
 *
 * Notes are deliberately not the same thing as findings or the alert's
 * description. Those are the record — what was wrong and what was done
 * — and belong to the device for its life. This is people talking:
 * a nurse adding that the fault only happens on mains power, a manager
 * asking whether the loan pump arrived.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, formatDateTime } from "../lib/api";
import { Button, Card } from "./ui";

export interface Note {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; fullName: string };
}

export function Notes({ basePath }: { basePath: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const query = useQuery({
    queryKey: ["notes", basePath],
    queryFn: () => api.get<{ notes: Note[] }>(`${basePath}/notes`),
  });

  const add = useMutation({
    mutationFn: () => api.post<Note>(`${basePath}/notes`, { body: draft.trim() }),
    onSuccess: () => {
      setDraft("");
      setError("");
      qc.invalidateQueries({ queryKey: ["notes", basePath] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not add that note.");
    },
  });

  const notes = query.data?.notes ?? [];

  return (
    <Card>
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-medium text-slate-800">
          Notes{notes.length > 0 && <span className="ml-1.5 text-slate-400">{notes.length}</span>}
        </h2>
      </header>

      {notes.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          No notes yet. Anything worth telling the next person goes here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {notes.map((note) => (
            <li key={note.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-slate-800">{note.author.fullName}</span>
                <span className="font-mono text-xs text-slate-400">
                  {formatDateTime(note.createdAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-slate-200 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          className="w-full resize-y rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-2 flex justify-end">
          <Button onClick={() => add.mutate()} disabled={!draft.trim() || add.isPending}>
            {add.isPending ? "Adding…" : "Add note"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
