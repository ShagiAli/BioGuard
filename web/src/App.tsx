import { BrowserRouter, Navigate, Route, Routes, useMatch } from "react-router-dom";
import { AuthProvider, Login, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Equipment } from "./pages/Equipment";
import { EquipmentDetail } from "./pages/EquipmentDetail";
import { Notifications } from "./pages/Notifications";
import { Inbox } from "./pages/Inbox";
import { Activity } from "./pages/Activity";
import { Alerts } from "./pages/Alerts";
import { AlertDetail } from "./pages/AlertDetail";
import { WorkOrderDetail } from "./pages/WorkOrderDetail";
import { WorkOrders } from "./pages/WorkOrders";
import { Scan } from "./pages/Scan";
import { ForgotPassword, ResetPassword } from "./passwordReset";
import { Spinner } from "./components/ui";

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
  if (scan?.params.token) return <Scan token={scan.params.token} />;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  // Signed out, but the reset flow still has to be reachable — someone
  // following a link from their mailbox has no session by definition.
  if (!user) {
    return (
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/equipment" element={<Equipment />} />
        <Route path="/equipment/:id" element={<EquipmentDetail />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/mail" element={<Inbox />} />
        {/* Role-gated in the API too; this only hides the link. */}
        <Route path="/activity" element={<Activity />} />
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
