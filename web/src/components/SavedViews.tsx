/**
 * Saving a filtered list, and coming back to it.
 *
 * The value saved is the page's own query string, so this is bookmarking
 * with a name on it. Applying one is a navigation, which is why picking
 * a view simply sets the URL and lets the page react as it would to any
 * other filter change.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";

interface View {
  id: string;
  name: string;
  resource: string;
  query: string;
}

export function SavedViews({
  resource,
  currentQuery,
  onApply,
}: {
  resource: "equipment" | "alerts" | "work-orders" | "activity";
  /** The query string this page is currently showing, without the "?". */
  currentQuery: string;
  onApply: (query: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const views = useQuery({
    queryKey: ["views", resource],
    queryFn: () => api.get<{ views: View[] }>(`/api/views?resource=${resource}`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["views", resource] });

  const save = useMutation({
    mutationFn: () =>
      api.post<View>("/api/views", { name: name.trim(), resource, query: currentQuery }),
    onSuccess: () => {
      setNaming(false);
      setName("");
      setError("");
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save that view."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/views/${id}`),
    onSuccess: invalidate,
  });

  const rows = views.data?.views ?? [];
  // Saving over a name replaces it, so the button says what will happen.
  const existing = rows.some((v) => v.name === name.trim());

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bookmark size={15} />
        Views
        {rows.length > 0 && <span className="text-slate-400">{rows.length}</span>}
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {rows.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">
                No saved views yet. Filter the list, then save it.
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto">
                {rows.map((view) => (
                  <li key={view.id} className="flex items-center gap-1 px-1 py-0.5">
                    <button
                      onClick={() => {
                        onApply(view.query);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 cursor-pointer truncate rounded px-2 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      {view.name}
                    </button>
                    <button
                      onClick={() => remove.mutate(view.id)}
                      className="cursor-pointer rounded p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-rose-600"
                      aria-label={`Delete ${view.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-slate-200 p-2">
              {naming ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && name.trim()) save.mutate();
                      if (e.key === "Escape") setNaming(false);
                    }}
                    placeholder="Name this view"
                    className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                  />
                  <button
                    onClick={() => save.mutate()}
                    disabled={!name.trim() || save.isPending}
                    className="cursor-pointer rounded p-1.5 text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Save view"
                  >
                    <Check size={16} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setNaming(true)}
                  className="w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm text-brand-700 transition hover:bg-brand-50"
                >
                  Save this view
                </button>
              )}
              {naming && existing && (
                <p className="px-2 pt-1.5 text-xs text-slate-500">Replaces the view of that name.</p>
              )}
              {error && <p className="px-2 pt-1.5 text-xs text-rose-600">{error}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
