/**
 * The QR scan target.
 *
 * Public by design: someone reading a label at the bedside has a phone
 * and no session. It therefore shows only what the server is willing to
 * hand out unauthenticated — name, asset number, status and location —
 * and nothing that would be useful to a person who found a discarded
 * label. Costs, history and identifiers stay behind the sign-in.
 *
 * Laid out for a phone held one-handed, which is the only way this page
 * is ever read.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, STATUS_LABELS, type OperationalStatus } from "../lib/api";

interface ScanResult {
  name: string;
  assetNo: string;
  status: OperationalStatus;
  location: string;
}

export function Scan({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["scan", token],
    queryFn: () => api.get<ScanResult>(`/api/equipment/public/${encodeURIComponent(token)}`),
    retry: false,
  });

  const operational = query.data?.status === "OPERATIONAL";

  return (
    <div className="flex min-h-screen justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm pt-10">
        <div className="mb-6 text-center">
          <div className="font-mono text-xl font-semibold tracking-tight text-teal-800">
            BioGuard
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          {query.isLoading && <p className="text-sm text-slate-500">Reading the label…</p>}

          {query.isError && (
            <>
              <h1 className="text-sm font-medium text-slate-900">Unknown code</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                This label is not in the register. It may belong to a device that has been
                retired, or the code may be damaged.
              </p>
            </>
          )}

          {query.data && (
            <>
              <div className="text-xs uppercase tracking-wide text-slate-400">Device</div>
              <h1 className="mt-1 text-lg font-medium text-slate-900">{query.data.name}</h1>
              <div className="mt-1 font-mono text-xs text-slate-500">
                Asset {query.data.assetNo}
              </div>

              <div
                className={`mt-4 rounded-md border px-3 py-2 text-sm font-medium ${
                  operational
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                {STATUS_LABELS[query.data.status]}
              </div>

              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">Location</div>
                <div className="mt-1 text-sm text-slate-800">{query.data.location}</div>
              </div>

              {!operational && (
                <p className="mt-4 text-xs leading-relaxed text-slate-500">
                  This device is not in normal service. Report a fault to biomedical engineering
                  rather than returning it to use.
                </p>
              )}
            </>
          )}
        </div>

        <Link
          to="/"
          className="mt-4 block text-center text-sm text-slate-500 underline hover:text-slate-800"
        >
          Staff sign in
        </Link>
      </div>
    </div>
  );
}
