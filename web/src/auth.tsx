import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type User } from "./lib/api";
import { Button } from "./components/ui";
import { Logo } from "./components/Logo";

interface AuthValue {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
  user: null,
  loading: true,
  signOut: async () => {},
});

// The hook lives with the provider that owns the context; splitting them
// to satisfy fast refresh would scatter one concern across two files.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  // A 401 here is the normal "not signed in" case, not an error state,
  // so it resolves to null rather than throwing into an error boundary.
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const res = await api.get<{ user: User }>("/api/auth/me");
        return res.user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
  });

  const signOut = async () => {
    await api.post("/api/auth/logout");
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <AuthContext.Provider value={{ user: data ?? null, loading: isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/login", { email, password });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-10 text-brand-700" />
            <div>
              <div className="text-2xl font-semibold tracking-tight text-brand-800">BioGuard</div>
              <div className="text-xs text-slate-500">Protecting care. Protecting life.</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-500">
            Biomedical equipment monitoring and maintenance
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Email</span>
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
            />
          </label>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button onClick={submit} disabled={busy || !email || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Link
              to="/forgot-password"
              className="text-sm text-slate-500 underline hover:text-slate-800"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Demo accounts were printed by the seed script.
        </p>
      </div>
    </div>
  );
}
