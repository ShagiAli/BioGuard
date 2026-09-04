/**
 * Global search, opened with the platform's command key and K.
 *
 * Staged: finished as a component, not mounted anywhere. It needs one
 * endpoint that searches equipment, alerts and work orders together —
 * see staged/README.md. Pass that as `search` and mount it in Layout's
 * top bar to turn it on.
 *
 * Takes its results through a prop rather than calling the API itself,
 * so the component can be tested and previewed without a backend, and
 * so the query shape stays the caller's decision.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";

export interface SearchHit {
  id: string;
  /** What kind of record this is, shown as the row's label. */
  kind: "Equipment" | "Alert" | "Work order";
  title: string;
  /** Asset number, alert reference, work order number — whatever identifies it. */
  reference: string;
  /** Where selecting the row should go. */
  to: string;
}

export function CommandSearch({
  search,
  placeholder = "Search equipment, alerts, work orders…",
}: {
  search: (query: string) => Promise<SearchHit[]>;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  /**
   * Closing resets here rather than in an effect watching `open`.
   * Clearing state as a reaction to state is the pattern that makes a
   * component render once with the old values and again with the new;
   * doing it in the handler means it never renders the stale pair.
   */
  const close = () => {
    setOpen(false);
    setTerm("");
    setHits([]);
    setActive(0);
  };

  // Cmd+K on macOS, Ctrl+K elsewhere. Escape closes from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced, so a query does not fire on every keystroke. An empty box
  // asks for nothing; what it should show is derived below rather than
  // written back into state.
  useEffect(() => {
    if (!term.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      search(term)
        .then((rows) => {
          if (!cancelled) {
            setHits(rows);
            setActive(0);
          }
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, search]);

  /** An empty box shows nothing, without that having to be written into state. */
  const results = term.trim() ? hits : [];

  const go = (hit: SearchHit) => {
    close();
    navigate(hit.to);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full max-w-md cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 transition hover:border-slate-300"
      >
        <Search size={15} />
        <span className="flex-1 text-left">{placeholder}</span>
        <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-400">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-24">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search size={16} className="text-slate-400" />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && results[active]) go(results[active]);
            }}
            placeholder={placeholder}
            className="flex-1 text-sm outline-none placeholder:text-slate-400"
          />
          <button
            onClick={close}
            className="cursor-pointer rounded p-1 text-slate-400 transition hover:bg-slate-100"
            aria-label="Close search"
          >
            <X size={15} />
          </button>
        </div>

        {term.trim() !== "" && results.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            Nothing matches “{term}”.
          </p>
        )}

        <ul className="max-h-80 overflow-y-auto">
          {results.map((hit, i) => (
            <li key={`${hit.kind}-${hit.id}`}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                  i === active ? "bg-brand-50" : "hover:bg-slate-50"
                }`}
              >
                <span className="w-24 shrink-0 font-mono text-xs text-slate-400">{hit.kind}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">{hit.title}</span>
                <span className="shrink-0 font-mono text-xs text-slate-500">{hit.reference}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
