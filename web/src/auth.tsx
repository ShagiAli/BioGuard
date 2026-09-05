import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, CalendarClock, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type User } from "./lib/api";
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
  const [showPassword, setShowPassword] = useState(false);

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
    <div
      className="grid min-h-screen bg-slate-50 bg-cover bg-left bg-no-repeat xl:grid-cols-2"
      style={{ backgroundImage: "url(/login-panel.jpg)" }}
    >
      {/* The form first in the document, so a screen reader and a narrow
          window both reach it before the marketing. */}
      <div className="flex items-center justify-center bg-white p-6 xl:bg-white/95 xl:backdrop-blur-sm">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 xl:hidden">
            <Logo className="h-9 w-9 text-brand-700" />
            <div>
              <div className="text-xl font-semibold tracking-tight text-brand-800">BioGuard</div>
              <div className="text-xs text-slate-500">Protecting care. Protecting life.</div>
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900 xl:mt-0">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your BioGuard account.</p>

          <label className="mt-6 block">
            <span className="text-xs uppercase tracking-wide text-slate-500">Email address</span>
            <input
              type="email"
              value={email}
              autoComplete="username"
              placeholder="you@hospital.nhs.uk"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-brand-500"
            />
          </label>

          <label className="mt-4 block">
            <span className="flex items-baseline justify-between text-xs uppercase tracking-wide text-slate-500">
              Password
              <Link
                to="/forgot-password"
                className="text-xs normal-case tracking-normal text-brand-700 hover:text-brand-800"
              >
                Forgot password?
              </Link>
            </span>
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="w-full rounded-md border border-slate-200 px-3 py-2.5 pr-10 text-sm outline-none transition focus:border-brand-500"
              />
              {/* Typing a password blind on a shared ward terminal is how
                  people get locked out of a system they need now. */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 text-slate-400 transition hover:text-slate-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

          <button
            onClick={submit}
            disabled={busy || !email || !password}
            className="mt-5 w-full cursor-pointer rounded-md bg-brand-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-6 text-center text-xs text-slate-400">
            Demo accounts were printed by the seed script.
          </p>
        </div>
      </div>

      {/*
       * The words, over the pale half of the photograph behind them.
       *
       * The photograph is the page's background rather than this panel's,
       * because this panel is portrait and the picture is roughly two to
       * one: cropped to fit here it zoomed until the monitor was the only
       * thing left and the text sat on top of it. Across the full width
       * the picture keeps its own composition — equipment right, ward
       * receding into white on the left — and the words go where the
       * photographer left room for them.
       *
       * xl rather than lg for the same reason. Below about 1280 the crop
       * is narrow enough that the equipment falls off the right edge and
       * the panel becomes a photograph of an empty bed; better to give
       * the form the whole screen, which is a layout this page already
       * has.
       *
       * The wash is not decoration. That half is pale rather than white
       * and carries bed rails and a second monitor — enough texture to
       * cost body text its contrast — so this holds it to something type
       * can sit on, and stops before the equipment.
       */}
      <div className="relative hidden items-center overflow-hidden xl:flex">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/90 via-white/70 to-transparent"
          aria-hidden="true"
        />

        <div className="relative min-w-0 max-w-sm py-12 pl-12 pr-6">
          <div className="flex items-center gap-3">
            <Logo className="h-11 w-11 text-brand-700" />
            <div>
              <div className="text-2xl font-semibold tracking-tight text-brand-900">BioGuard</div>
              <div className="text-xs text-slate-500">Protecting care. Protecting life.</div>
            </div>
          </div>

          <h2 className="mt-10 text-balance text-3xl font-semibold leading-tight tracking-tight text-slate-900">
            Smart equipment management for better patient care
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Track, maintain and evidence every device across the hospital — and know a service is
            due before it is late.
          </p>

          <ul className="mt-10 space-y-6">
            {[
              {
                icon: Activity,
                title: "Real-time visibility",
                body: "Every device, its department and its service state, in one list you can filter and share.",
              },
              {
                icon: CalendarClock,
                title: "Proactive maintenance",
                body: "A nightly sweep raises reminders on a ladder, so nothing quietly falls overdue.",
              },
              {
                icon: ShieldCheck,
                title: "Better compliance",
                body: "Every service, repair and status change recorded, with who did it and when.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-700 shadow-sm">
                  <Icon size={17} className="text-white" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
