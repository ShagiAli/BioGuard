import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "./lib/api";
import { Button } from "./components/ui";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="font-mono text-2xl font-semibold tracking-tight text-teal-800">
            BioGuard
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Biomedical equipment monitoring and maintenance
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/api/auth/forgot-password", { email });
    } catch {
      // Deliberately ignored. The server answers identically whether or
      // not the address exists, and the client must not undo that by
      // behaving differently on an error.
    } finally {
      setSent(true);
      setBusy(false);
    }
  };

  return (
    <Frame>
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        {sent ? (
          <>
            <CheckCircle2 size={20} className="text-emerald-600" />
            <h1 className="mt-2 text-sm font-medium text-slate-900">Check your messages</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              If that address is registered, a reset link is on its way. It expires in 30 minutes
              and can be used once.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-sm font-medium text-slate-900">Reset your password</h1>
            <p className="mt-1 text-sm text-slate-500">
              Enter your work email and we will send a link.
            </p>

            <label className="mt-4 block">
              <span className="text-xs uppercase tracking-wide text-slate-500">Email</span>
              <input
                type="email"
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email && submit()}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            </label>

            <div className="mt-4">
              <Button onClick={submit} disabled={busy || !email}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </div>
          </>
        )}
      </div>

      <Link
        to="/"
        className="mt-4 flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={14} /> Back to sign in
      </Link>
    </Frame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <Frame>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h1 className="text-sm font-medium text-slate-900">This link is incomplete</h1>
          <p className="mt-2 text-sm text-slate-600">
            Open the link from your reset message, or request a new one.
          </p>
          <div className="mt-4">
            <Button onClick={() => navigate("/forgot-password")}>Request a new link</Button>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        {done ? (
          <>
            <CheckCircle2 size={20} className="text-emerald-600" />
            <h1 className="mt-2 text-sm font-medium text-slate-900">Password updated</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Every existing session has been signed out, including any on other devices.
            </p>
            <div className="mt-4">
              <Button onClick={() => navigate("/")}>Sign in</Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-sm font-medium text-slate-900">Choose a new password</h1>

            <label className="mt-4 block">
              <span className="text-xs uppercase tracking-wide text-slate-500">New password</span>
              <input
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
              <span className="mt-1 block text-xs text-slate-400">At least 12 characters.</span>
            </label>

            <label className="mt-3 block">
              <span className="text-xs uppercase tracking-wide text-slate-500">Confirm</span>
              <input
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            </label>

            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

            <div className="mt-4">
              <Button onClick={submit} disabled={busy || !password || !confirm}>
                {busy ? "Saving…" : "Set new password"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}
