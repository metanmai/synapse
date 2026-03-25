import { Routes, Route, Navigate } from "react-router-dom";

import { useAuth } from "./lib/auth";
import { AppShell } from "./components/layout";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectWorkspace } from "./pages/ProjectWorkspace";
import { ProjectSettings } from "./pages/ProjectSettings";
import { ActivityPage } from "./pages/ActivityPage";
import { HistoryPage } from "./pages/HistoryPage";
import { AccountPage } from "./pages/AccountPage";
import { ShareAcceptPage } from "./pages/ShareAcceptPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/share/:token" element={<ShareAcceptPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects/:name" element={<ProjectWorkspace />} />
        <Route path="/projects/:name/settings" element={<ProjectSettings />} />
        <Route path="/projects/:name/activity" element={<ActivityPage />} />
        <Route path="/projects/:name/history/*" element={<HistoryPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
    </Routes>
  );
}
