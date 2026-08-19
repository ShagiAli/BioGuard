import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, Login, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Equipment } from "./pages/Equipment";
import { EquipmentDetail } from "./pages/EquipmentDetail";
import { Notifications } from "./pages/Notifications";
import { Inbox } from "./pages/Inbox";
import { ForgotPassword, ResetPassword } from "./passwordReset";
import { Spinner } from "./components/ui";

function Shell() {
  const { user, loading } = useAuth();

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
