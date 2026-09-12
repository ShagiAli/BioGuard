import { BrowserRouter, Navigate, Route, Routes, useMatch } from "react-router-dom";
import { AuthProvider, Login, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Equipment } from "./pages/Equipment";
import { EquipmentDetail } from "./pages/EquipmentDetail";
import { EquipmentForm } from "./pages/EquipmentForm";
import { Notifications } from "./pages/Notifications";
import { Activity } from "./pages/Activity";
import { Users } from "./pages/Users";
import { Alerts } from "./pages/Alerts";
import { AlertDetail } from "./pages/AlertDetail";
import { WorkOrderDetail } from "./pages/WorkOrderDetail";
import { WorkOrders } from "./pages/WorkOrders";
import { Scan } from "./pages/Scan";
import { ForgotPassword, ResetPassword } from "./passwordReset";
import { Spinner } from "./components/ui";

type Role = "ADMIN" | "MANAGER" | "HEAD_OF_ALERTS" | "ENGINEER" | "STAFF";

/**
 * A route only some roles may open.
 *
 * The API already refuses these, so this is not what keeps the data
 * safe. It decides what somebody sees when they arrive anyway — by
 * typing the path, or following a link from a colleague who has the
 * role they do not. Without it the page mounts, asks, is refused, and
 * renders its own failure: an engineer reads an error where the honest
 * answer is that the page is not theirs.
 *
 * Sent to the dashboard rather than shown a refusal, because a refusal
 * is only useful when the reader could do something about it, and
 * nobody can grant themselves a role.
 */
function RequireRole({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  return allow.includes(user.role as Role) ? <>{children}</> : <Navigate to="/" replace />;
}

function Shell() {
  const { user, loading } = useAuth();

  /**
   * The QR scan target, matched ahead of everything else.
   *
   * It is the one route that must render identically signed in or out,
   * and must not wait on the session probe — a nurse scanning a label at
   * the bedside should not be shown "Checking your session", still less
   * a login form.
   */
  const scan = useMatch("/e/:token");

  /**
   * Setting a password, reachable whether or not somebody is signed in.
   *
   * These used to live only in the signed-out branch, on the reasoning
   * that "someone following a link from their mailbox has no session by
   * definition". That is simply not true: people read mail in the
   * browser they are already signed in with. For them the reset page was
   * not in the route table at all, so the catch-all sent them to the
   * dashboard — which looks exactly like the link having signed them in,
   * and is alarming for a link that is supposed to prove who you are.
   *
   * Matched here rather than duplicated into both branches, and ahead of
   * the session probe, because neither page needs to know who is asking.
   */
  const resetting = useMatch("/reset-password");
  const forgetting = useMatch("/forgot-password");

  // Every match above is read before anything returns: a hook skipped on
  // the renders where an earlier route won would change the hook order.
  if (scan?.params.token) return <Scan token={scan.params.token} />;
  if (resetting) return <ResetPassword />;
  if (forgetting) return <ForgotPassword />;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  // The password routes are handled above, so this is everything else.
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/equipment" element={<Equipment />} />
        <Route path="/equipment/new" element={<EquipmentForm />} />
        <Route path="/equipment/:id/edit" element={<EquipmentForm />} />
        <Route path="/equipment/:id" element={<EquipmentDetail />} />
        <Route path="/notifications" element={<Notifications />} />
        {/* Role-gated in the API too; this only hides the link. */}
        <Route path="/activity" element={<Activity />} />
        <Route
          path="/people"
          element={
            <RequireRole allow={["ADMIN", "MANAGER"]}>
              <Users />
            </RequireRole>
          }
        />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/alerts/:id" element={<AlertDetail />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}
