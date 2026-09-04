import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { AuthApi } from "@/api/client";
import { setPendingJoinCode } from "@/auth/joinPrefs";
import { clearSession, getSessionId, persistSession } from "@/auth/session";

export function AuthBootstrap() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const me = await AuthApi.me();
        if (cancelled) return;
        persistSession({
          sessionId: getSessionId(),
          userId: me.userId,
          displayName: me.displayName,
          role: me.role,
          roles: (me as { roles?: string[] }).roles,
          permissions: (me as { permissions?: string[] }).permissions,
          username: me.username,
        });
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const raw = err instanceof Error ? err.message : String(err);
        if (raw.startsWith("401")) {
          const join =
            new URLSearchParams(window.location.search)
              .get("join")
              ?.replace(/\D/g, "") ?? "";
          if (join.length === 9) setPendingJoinCode(join);
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!ready) return null;
  return <Outlet />;
}
