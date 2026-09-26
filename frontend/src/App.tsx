import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { useAuth } from "./lib/auth";
import { StoryProvider } from "./lib/stories";
import { ActivityPage } from "./pages/Activity";
import { AlertsPage } from "./pages/Alerts";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { CollectionsPage } from "./pages/Collections";
import { DashboardPage } from "./pages/Dashboard";
import { IntegrationsCallback, IntegrationsPage, OnboardingPage } from "./pages/Integrations";
import { ScenariosPage } from "./pages/Scenarios";
import { SettingsPage } from "./pages/Settings";
import { TrackerPage } from "./pages/Tracker";

function Protected({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (loading) return <Loading />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  return token ? <Navigate to="/" replace /> : <>{children}</>;
}

export function App() {
  return (
    <StoryProvider>
      <AppRoutes />
    </StoryProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
      <Route path="/integrations/callback" element={<Protected><IntegrationsCallback /></Protected>} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="/scenarios" element={<ScenariosPage />} />
        <Route path="/tracker" element={<TrackerPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
