import type { ReactNode } from "react";

export type Tone = "rose" | "amber" | "sky" | "slate" | "emerald" | "teal";

const TONES: Record<Tone, string> = {
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  slate: "bg-slate-50 text-slate-600 border-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  teal: "bg-teal-50 text-teal-800 border-teal-200",
};

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

// Tone mapping belongs beside the Badge it feeds. Same trade-off as in
// auth.tsx: colocation over fast-refresh granularity.
// eslint-disable-next-line react-refresh/only-export-components
export function pmTone(state: string): Tone {
  if (state === "OVERDUE") return "rose";
  if (state === "DUE_NOW") return "amber";
  if (state === "DUE_SOON") return "sky";
  return "slate";
}

export function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm text-slate-800 ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>{children}</div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      {label}…
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
      {message}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300",
    ghost: "border border-slate-200 bg-white text-slate-700 hover:border-slate-300",
    danger: "border border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:text-rose-700",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles}`}
    >
      {children}
    </button>
  );
}

/**
 * Page footer for any paginated list.
 *
 * Extracted from the equipment table when notifications and mail gained
 * paging, so all three step through results identically rather than
 * growing three slightly different footers.
 */
/**
 * The page numbers to draw, with gaps where the list is long.
 *
 * Always shows the first and last page and a window around the current
 * one, so the footer stays a fixed width whether there are three pages
 * or three hundred. `null` marks an elision.
 */
function pageWindow(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const shown = new Set([1, totalPages, page, page - 1, page + 1]);
  // Keep the run next to whichever end we are near, so the control does
  // not shrink and grow as you page through.
  if (page <= 3) [2, 3, 4].forEach((n) => shown.add(n));
  if (page >= totalPages - 2)
    [totalPages - 3, totalPages - 2, totalPages - 1].forEach((n) => shown.add(n));

  const pages = [...shown].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const n of pages) {
    if (previous && n - previous > 1) out.push(null);
    out.push(n);
    previous = n;
  }
  return out;
}

const PAGE_SIZES = [20, 50, 100] as const;

export function Pager({
  page,
  totalPages,
  onChange,
  total,
  pageSize,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
  /** Row count across every page, for the "showing x to y" line. */
  total?: number;
  pageSize?: number;
  onPageSize?: (next: number) => void;
}) {
  const showRange = total !== undefined && pageSize !== undefined;
  const first = showRange ? Math.min((page - 1) * pageSize + 1, total) : 0;
  const last = showRange ? Math.min(page * pageSize, total) : 0;

  // Renders for a single page when there is a count to state: a footer
  // that vanishes makes the table jump as a filter narrows the results.
  if (totalPages <= 1 && !showRange) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
      <span className="tabular-nums">
        {showRange ? (
          total === 0 ? (
            "No results"
          ) : (
            <>
              Showing {first} to {last} of {total} result{total === 1 ? "" : "s"}
            </>
          )
        ) : (
          <>
            Page {page} of {totalPages}
          </>
        )}
      </span>

      <div className="flex items-center gap-3">
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => onChange(page - 1)}
              className="cursor-pointer rounded border border-slate-200 px-2 py-1 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous page"
            >
              ‹
            </button>

            {pageWindow(page, totalPages).map((n, i) =>
              n === null ? (
                <span key={`gap-${i}`} className="px-1 text-slate-400">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => onChange(n)}
                  aria-current={n === page ? "page" : undefined}
                  className={`min-w-7 cursor-pointer rounded border px-2 py-1 tabular-nums transition ${
                    n === page
                      ? "border-brand-600 bg-brand-600 font-medium text-white"
                      : "border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {n}
                </button>
              )
            )}

            <button
              disabled={page >= totalPages}
              onClick={() => onChange(page + 1)}
              className="cursor-pointer rounded border border-slate-200 px-2 py-1 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        )}

        {onPageSize && pageSize !== undefined && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

export type SortDirection = "asc" | "desc";

/**
 * A sortable column heading.
 *
 * Ordering happens in the database, not here — sorting only the rows
 * already on screen would reorder 25 of 184 and read as a bug. This
 * reports the intent; the caller puts it in the URL and the API applies
 * it.
 */
export function SortableHeader({
  label,
  column,
  sort,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  column: string;
  sort: string | null;
  dir: SortDirection;
  onSort: (column: string, dir: SortDirection) => void;
  className?: string;
}) {
  const active = sort === column;
  // A fresh column starts ascending; the active one flips.
  const next: SortDirection = active && dir === "asc" ? "desc" : "asc";

  return (
    <th
      className={`px-4 py-2.5 font-medium ${className}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() => onSort(column, next)}
        className="flex cursor-pointer items-center gap-1 transition hover:text-slate-900"
      >
        {label}
        <span className={active ? "text-brand-700" : "text-slate-300"} aria-hidden="true">
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

/**
 * "Sort by" for a list that is not a table.
 *
 * Equipment sorts from its column headings, which only works where
 * there are headings to click. Alerts, work orders and activity are
 * card lists, so the same choice becomes a select — the design shows
 * both, and this is the half that fits a list with no columns.
 *
 * Each option carries its own direction, so a label can say what it
 * means: "Most urgent first" rather than "priority, ascending", which
 * is only obvious once you know the enum is declared worst-first.
 */
export function SortSelect({
  options,
  sort,
  dir,
  onSort,
}: {
  options: { label: string; column: string; dir: SortDirection }[];
  sort: string | null;
  dir: SortDirection;
  onSort: (column: string, dir: SortDirection) => void;
}) {
  const current = options.find((o) => o.column === sort && o.dir === dir) ?? options[0];

  return (
    <label className="flex items-center gap-2 text-sm text-slate-500">
      <span className="whitespace-nowrap">Sort by</span>
      <select
        value={current ? `${current.column}:${current.dir}` : ""}
        onChange={(e) => {
          const [column, next] = e.target.value.split(":");
          if (column && next) onSort(column, next as SortDirection);
        }}
        className="cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
      >
        {options.map((o) => (
          <option key={`${o.column}:${o.dir}`} value={`${o.column}:${o.dir}`}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
/**
 * Downloads the current list as CSV.
 *
 * A link rather than a fetch, so the browser owns the download and the
 * session cookie travels with it. It points at the query the table is
 * showing plus `format=csv`, so an export is the filtered set — not the
 * page someone happens to be on, and not everything.
 */
export function ExportButton({ href, label = "Export" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
    >
      {label}
    </a>
  );
}
