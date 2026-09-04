export type UserRole = "admin" | "user";

export function getSessionId() {
  return localStorage.getItem("sessionId") ?? "";
}
export function getDisplayName() {
  return localStorage.getItem("displayName") ?? "";
}
export function getRole(): UserRole {
  return localStorage.getItem("role") === "admin" ? "admin" : "user";
}
export function getRoles(): string[] {
  try {
    return JSON.parse(localStorage.getItem("roles") ?? "[]");
  } catch {
    return [];
  }
}
export function getPermissions(): string[] {
  try {
    return JSON.parse(localStorage.getItem("permissions") ?? "[]");
  } catch {
    return [];
  }
}
export function getUserId(): number | null {
  const raw = localStorage.getItem("userId");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
export function isAdmin() {
  const roles = getRoles();
  return roles.includes("admin") || getRole() === "admin";
}

/**
 * 判断是否为管理后台用户（三员 + 超级管理员）。
 * admin / sys_admin / auth_admin / audit_admin 均可进入管理后台。
 */
export function isManager() {
  const roles = getRoles();
  return (
    roles.includes("admin") ||
    roles.includes("sys_admin") ||
    roles.includes("auth_admin") ||
    roles.includes("audit_admin")
  );
}

export function hasPermission(perm: string): boolean {
  if (isAdmin()) return true;
  return getPermissions().includes(perm);
}
export function persistSession(input: {
  sessionId: string;
  userId: number;
  displayName: string;
  role: UserRole;
  roles?: string[];
  permissions?: string[];
  username?: string;
}) {
  localStorage.setItem("sessionId", input.sessionId);
  localStorage.setItem("userId", String(input.userId));
  localStorage.setItem("displayName", input.displayName);
  localStorage.setItem("role", input.role);
  if (input.roles) localStorage.setItem("roles", JSON.stringify(input.roles));
  if (input.permissions) localStorage.setItem("permissions", JSON.stringify(input.permissions));
  if (input.username) localStorage.setItem("username", input.username);
}
export function clearSession() {
  localStorage.removeItem("sessionId");
  localStorage.removeItem("userId");
  localStorage.removeItem("displayName");
  localStorage.removeItem("role");
  localStorage.removeItem("roles");
  localStorage.removeItem("permissions");
  localStorage.removeItem("username");
}
