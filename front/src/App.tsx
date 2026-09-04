import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useSearchParams,
} from "react-router-dom";
import { setPendingJoinCode } from "@/auth/joinPrefs";
import { getSessionId, isManager, getRoles } from "@/auth/session";
import { AppShell } from "@/components/AppShell";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { MeetingPage } from "@/pages/MeetingPage";

// ── 会议应用页面 ──
const RecordingsPage = lazy(() =>
  import("@/pages/RecordingsPage").then((m) => ({ default: m.RecordingsPage })),
);
const GroupManagePage = lazy(() =>
  import("@/pages/GroupManagePage").then((m) => ({ default: m.GroupManagePage })),
);

// ── 系统管理页面 ──
const ManagerLoginPage = lazy(() =>
  import("@/pages/manager/ManagerLoginPage").then((m) => ({ default: m.ManagerLoginPage })),
);
const UsersPage = lazy(() =>
  import("@/pages/manager/UsersPage").then((m) => ({ default: m.UsersPage })),
);
const DeptsPage = lazy(() =>
  import("@/pages/manager/DeptsPage").then((m) => ({ default: m.DeptsPage })),
);
const RolesPage = lazy(() =>
  import("@/pages/manager/RolesPage").then((m) => ({ default: m.RolesPage })),
);
const MenusPage = lazy(() =>
  import("@/pages/manager/MenusPage").then((m) => ({ default: m.MenusPage })),
);
const ConfigsPage = lazy(() =>
  import("@/pages/manager/ConfigsPage").then((m) => ({ default: m.ConfigsPage })),
);
const NoticesPage = lazy(() =>
  import("@/pages/manager/NoticesPage").then((m) => ({ default: m.NoticesPage })),
);
const OperLogPage = lazy(() =>
  import("@/pages/manager/OperLogPage").then((m) => ({ default: m.OperLogPage })),
);
const MeetingApprovalPage = lazy(() =>
  import("@/pages/manager/MeetingApprovalPage").then((m) => ({ default: m.MeetingApprovalPage })),
);
const MeetingMonitorPage = lazy(() =>
  import("@/pages/manager/MeetingMonitorPage").then((m) => ({ default: m.MeetingMonitorPage })),
);
const UserApprovalPage = lazy(() =>
  import("@/pages/manager/UserApprovalPage").then((m) => ({ default: m.UserApprovalPage })),
);
const ManagerShell = lazy(() =>
  import("@/components/ManagerShell").then((m) => ({ default: m.ManagerShell })),
);

// ── 会议应用鉴权：未登录跳 /login ──
function RequireAuth() {
  const [searchParams] = useSearchParams();
  if (!getSessionId()) {
    const join = searchParams.get("join")?.replace(/\D/g, "") ?? "";
    if (join.length === 9) setPendingJoinCode(join);
    return <Navigate to="/login" replace />;
  }
  return <AuthBootstrap />;
}

// ── 系统管理鉴权：未登录跳 /manager/login ──
function RequireManagerAuth() {
  if (!getSessionId()) {
    return <Navigate to="/manager/login" replace />;
  }
  if (!isManager()) {
    return <Navigate to="/manager/login" replace />;
  }
  return <Outlet />;
}

/**
 * 管理后台首页：根据角色跳转到有权限的第一个页面。
 */
function ManagerIndex() {
  const roles = getRoles();
  let defaultPath = "/manager/user";
  if (roles.includes("admin") || roles.includes("sys_admin")) defaultPath = "/manager/user";
  else if (roles.includes("auth_admin")) defaultPath = "/manager/meeting-approval";
  else if (roles.includes("audit_admin")) defaultPath = "/manager/operlog";
  return <Navigate to={defaultPath} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── 会议应用入口 ── */}
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/recordings"
              element={<Suspense fallback={null}><RecordingsPage /></Suspense>}
            />
            <Route
              path="/groups"
              element={<Suspense fallback={null}><GroupManagePage /></Suspense>}
            />
          </Route>
          <Route path="/m/:meetingId" element={<MeetingPage />} />
        </Route>

        {/* ── 系统管理入口（独立登录，与会议应用互不干扰） ── */}
        <Route path="/manager/login" element={
          <Suspense fallback={null}><ManagerLoginPage /></Suspense>
        } />
        <Route element={<RequireManagerAuth />}>
          <Route
            path="/manager"
            element={<Suspense fallback={null}><ManagerShell /></Suspense>}
          >
            <Route path="user" element={<Suspense fallback={null}><UsersPage /></Suspense>} />
            <Route path="dept" element={<Suspense fallback={null}><DeptsPage /></Suspense>} />
            <Route path="role" element={<Suspense fallback={null}><RolesPage /></Suspense>} />
            <Route path="menu" element={<Suspense fallback={null}><MenusPage /></Suspense>} />
            <Route path="config" element={<Suspense fallback={null}><ConfigsPage /></Suspense>} />
            <Route path="notice" element={<Suspense fallback={null}><NoticesPage /></Suspense>} />
            <Route path="operlog" element={<Suspense fallback={null}><OperLogPage /></Suspense>} />
            <Route path="meeting-approval" element={<Suspense fallback={null}><MeetingApprovalPage /></Suspense>} />
            <Route path="meeting-monitor" element={<Suspense fallback={null}><MeetingMonitorPage /></Suspense>} />
            <Route path="user-approval" element={<Suspense fallback={null}><UserApprovalPage /></Suspense>} />
            <Route index element={<ManagerIndex />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
