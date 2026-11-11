import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
import { useSession } from "./lib/session";
import { AuthPage } from "./pages/Auth";
import { Onboarding } from "./pages/Onboarding";
import { Workspace } from "./pages/Workspace";
import { Settings } from "./pages/Settings";
import { Logo } from "./components/ui";

function Splash({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Logo />
        {children ?? <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Loading" />}
      </div>
    </div>
  );
}

/** Routes that need an account. Sends people without a brand to onboarding. */
function RequireUser({ children, needsBrand = true }: { children: ReactNode; needsBrand?: boolean }) {
  const { user, brand } = useSession();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (needsBrand && (!brand || !brand.onboarded)) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, brand } = useSession();
  if (user) return <Navigate to={brand?.onboarded ? "/" : "/onboarding"} replace />;
  return <>{children}</>;
}

function App() {
  const { status, error, bootstrap } = useSession();
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === "loading") return <Splash />;
  if (status === "error")
    return (
      <Splash>
        <p className="text-fg-secondary max-w-sm">{error}</p>
        <button className="btn-primary" onClick={() => void bootstrap()}>Try again</button>
      </Splash>
    );

  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><AuthPage mode="login" /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><AuthPage mode="signup" /></GuestOnly>} />
      <Route path="/onboarding" element={<RequireUser needsBrand={false}><Onboarding /></RequireUser>} />
      <Route path="/settings" element={<RequireUser><Settings /></RequireUser>} />
      <Route path="/" element={<RequireUser><Workspace view="map" /></RequireUser>} />
      <Route path="/shortlist" element={<RequireUser><Workspace view="shortlist" /></RequireUser>} />
      <Route path="/assistant" element={<RequireUser><Workspace view="assistant" /></RequireUser>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <App />
    </BrowserRouter>
  </StrictMode>
);
