import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, Login, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Equipment } from "./pages/Equipment";
import { EquipmentDetail } from "./pages/EquipmentDetail";
import { Notifications } from "./pages/Notifications";
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

  if (!user) return <Login />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/equipment" element={<Equipment />} />
        <Route path="/equipment/:id" element={<EquipmentDetail />} />
        <Route path="/notifications" element={<Notifications />} />
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
