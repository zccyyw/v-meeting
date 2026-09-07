import { getSessionId } from "@/auth/session";
import { encryptPassword } from "@meeting/shared";

function resolveApiBase(): string {
  const env = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (env && env !== "auto") {
    if (env.startsWith("/") && typeof window !== "undefined") {
      return `${window.location.origin}${env.replace(/\/$/, "")}`;
    }
    return env.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api`;
  }
  return "http://127.0.0.1:8080";
}

const API_BASE = resolveApiBase();

async function throwApiError(res: Response): Promise<never> {
  let errorCode: string | null = null;
  try {
    const text = await res.text();
    if (text) {
      const body = JSON.parse(text) as unknown;
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
      ) {
        errorCode = (body as { error: string }).error;
      }
    }
  } catch {
    /* ignore parse failures */
  }
  throw new Error(errorCode ? `${res.status} ${errorCode}` : `${res.status}`);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null) {
    headers.set("content-type", "application/json");
  }
  const sid = getSessionId();
  if (sid) headers.set("x-session-id", sid);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) await throwApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const AuthApi = {
  login: async (body: { username: string; password: string }) => {
    const encPwd = await encryptPassword(body.password);
    return api<{
      sessionId: string;
      userId: number;
      displayName: string;
      role: "admin" | "user";
      username?: string;
      roles?: string[];
      permissions?: string[];
      mustChangePassword?: boolean;
      passwordExpired?: boolean;
      forceChangePassword?: boolean;
    }>("/auth/login", { method: "POST", body: JSON.stringify({ ...body, password: encPwd }) });
  },
  me: () =>
    api<{ userId: number; username: string; displayName: string; role: "admin" | "user"; roles?: string[]; permissions?: string[] }>(
      "/auth/me",
    ),
  changePassword: async (body: { currentPassword: string; newPassword: string }) => {
    const [encCurrent, encNew] = await Promise.all([
      encryptPassword(body.currentPassword),
      encryptPassword(body.newPassword),
    ]);
    return api<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: encCurrent, newPassword: encNew }),
    });
  },
};

export type UserRow = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  phone: string | null;
  createdAt: string;
  updatedAt: string;
};

export const UsersApi = {
  list: (q: { q?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (q.q) sp.set("q", q.q);
    if (q.page) sp.set("page", String(q.page));
    if (q.pageSize) sp.set("pageSize", String(q.pageSize));
    return api<{ items: UserRow[]; total: number; page: number; pageSize: number }>(
      `/users?${sp}`,
    );
  },
  create: (body: Record<string, unknown>) =>
    api<UserRow>("/users", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: Record<string, unknown>) =>
    api<UserRow>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/users/${id}`, { method: "DELETE" }),
  exportUrl: () => `${API_BASE}/users/export`,
  importFile: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const headers = new Headers();
    const sid = getSessionId();
    if (sid) headers.set("x-session-id", sid);
    const res = await fetch(`${API_BASE}/users/import`, { method: "POST", headers, body: fd });
    if (!res.ok) await throwApiError(res);
    return res.json() as Promise<{ created: number; updated: number; total: number }>;
  },
};

export async function downloadExport(ids: number[], q?: string) {
  const headers = new Headers();
  const sid = getSessionId();
  if (sid) headers.set("x-session-id", sid);
  headers.set("content-type", "application/json");
  const res = await fetch(UsersApi.exportUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ ids, q: q || undefined }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "users.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function downloadImportTemplate() {
  const headers = new Headers();
  const sid = getSessionId();
  if (sid) headers.set("x-session-id", sid);
  const res = await fetch(`${API_BASE}/users/import-template`, { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "users-import-template.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
}

export const MeetingApi = {
  create: (body: {
    title: string;
    scheduledAt?: string;
    waitingRoomEnabled?: boolean;
    joinPassword?: string;
  }) =>
    api<{
      id: number;
      code: string;
      title: string;
      status: string;
      scheduledAt: string | null;
      hostJoinToken: string | null;
    }>("/meetings", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listMine: () =>
    api<{
      items: {
        id: number;
        code: string;
        title: string;
        status: string;
        scheduledAt: string | null;
        createdAt: string;
        priority: string | null;
      }[];
    }>("/meetings"),
  get: (id: string | number) =>
    api<{
      id: number;
      code: string;
      title: string;
      status: string;
      passwordRequired?: boolean;
    }>(`/meetings/${id}`),
  byCode: (code: string) =>
    api<{
      id: number;
      code: string;
      title: string;
      passwordRequired: boolean;
    }>(`/meetings/by-code/${code}`),
  joinToken: (id: string | number, body?: { password?: string }) =>
    api<{ token: string; role: string }>(`/meetings/${id}/join-token`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
};

export type RecordingItem = {
  id: number;
  meetingId: number | null;
  meetingTitle: string | null;
  meetingCode: string | null;
  title: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  url: string;
};

export type RecordingsListResult = {
  items: RecordingItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const RecordingsApi = {
  list: (params?: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.page != null) q.set("page", String(params.page));
    if (params?.pageSize != null) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return api<RecordingsListResult>(`/recordings${qs ? `?${qs}` : ""}`);
  },
  remove: (id: number) => api<{ ok: boolean }>(`/recordings/${id}`, { method: "DELETE" }),
  upload: async (file: Blob, meta: {
    title: string;
    meetingId?: number | null;
    durationMs?: number;
  }) => {
    const fd = new FormData();
    fd.append("file", file, "recording.webm");
    fd.append("title", meta.title);
    if (meta.meetingId != null) fd.append("meetingId", String(meta.meetingId));
    if (meta.durationMs != null) fd.append("durationMs", String(meta.durationMs));
    const headers = new Headers();
    const sid = getSessionId();
    if (sid) headers.set("x-session-id", sid);
    const res = await fetch(`${API_BASE}/recordings/upload`, {
      method: "POST",
      headers,
      body: fd,
    });
    if (!res.ok) await throwApiError(res);
    return res.json() as Promise<{ id: number; url: string }>;
  },
  downloadUrl: (id: number) => `${API_BASE}/recordings/${id}/download`,
  /** Fetch recording as a Blob (carries session header) for preview/download. */
  fetchBlob: async (id: number) => {
    const headers = new Headers();
    const sid = getSessionId();
    if (sid) headers.set("x-session-id", sid);
    const res = await fetch(`${API_BASE}/recordings/${id}/download`, { headers });
    if (!res.ok) await throwApiError(res);
    return res.blob();
  },
};

// ── 系统管理 API ──

export type DeptItem = {
  deptId: number;
  parentId: number;
  ancestors: string;
  deptName: string;
  orderNum: number;
  leader: string;
  phone: string;
  email: string;
  status: string;
  delFlag: string;
  createTime: string;
  children?: DeptItem[];
};

export const SysDeptApi = {
  list: (params?: { deptName?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.deptName) sp.set("deptName", params.deptName);
    if (params?.status) sp.set("status", params.status);
    return api<{ items: DeptItem[]; tree: DeptItem[] }>(`/sys-dept/list?${sp}`);
  },
  get: (id: number) => api<DeptItem>(`/sys-dept/${id}`),
  create: (body: Record<string, unknown>) =>
    api<DeptItem>("/sys-dept", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: Record<string, unknown>) =>
    api<DeptItem>(`/sys-dept/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/sys-dept/${id}`, { method: "DELETE" }),
};

export type RoleItem = {
  roleId: number;
  roleName: string;
  roleKey: string;
  roleSort: number;
  dataScope: string;
  menuCheckStrictly: boolean;
  deptCheckStrictly: boolean;
  status: string;
  delFlag: string;
  remark: string;
  createTime: string;
  menuIds?: number[];
};

export const SysRoleApi = {
  list: (params?: { roleName?: string; roleKey?: string; status?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.roleName) sp.set("roleName", params.roleName);
    if (params?.roleKey) sp.set("roleKey", params.roleKey);
    if (params?.status) sp.set("status", params.status);
    if (params?.page) sp.set("page", String(params.page));
    if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
    return api<{ items: RoleItem[]; total: number; page: number; pageSize: number }>(`/sys-role/list?${sp}`);
  },
  get: (id: number) => api<RoleItem & { menuIds: number[] }>(`/sys-role/${id}`),
  create: (body: Record<string, unknown>) =>
    api<RoleItem>("/sys-role", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: Record<string, unknown>) =>
    api<RoleItem>(`/sys-role/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/sys-role/${id}`, { method: "DELETE" }),
  menuTreeSelect: () => api<{ id: number; label: string; children?: unknown[] }[]>(`/sys-role/menu-treeselect`),
};

export type MenuItem = {
  menuId: number;
  menuName: string;
  parentId: number;
  orderNum: number;
  path: string;
  component: string;
  query: string;
  routeName: string;
  isFrame: boolean;
  isCache: boolean;
  menuType: "M" | "C" | "F";
  visible: string;
  status: string;
  perms: string;
  icon: string;
  createTime: string;
  remark: string;
  children?: MenuItem[];
};

export const SysMenuApi = {
  list: (params?: { menuName?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.menuName) sp.set("menuName", params.menuName);
    if (params?.status) sp.set("status", params.status);
    return api<{ items: MenuItem[]; tree: MenuItem[] }>(`/sys-menu/list?${sp}`);
  },
  get: (id: number) => api<MenuItem>(`/sys-menu/${id}`),
  create: (body: Record<string, unknown>) =>
    api<MenuItem>("/sys-menu", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: Record<string, unknown>) =>
    api<MenuItem>(`/sys-menu/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/sys-menu/${id}`, { method: "DELETE" }),
  routes: () => api<{ tree: MenuItem[] }>(`/sys-menu/routes`),
};

// ── 用户管理 API（若依风格） ──

export type SysUserItem = {
  userId: number;
  deptId: number | null;
  userName: string;
  nickName: string;
  userType: string;
  email: string;
  phonenumber: string;
  sex: string;
  avatar: string;
  status: string;
  delFlag: string;
  loginIp: string;
  loginDate: string;
  createTime: string;
  updateTime: string;
  remark: string;
  roleIds: number[];
};

export const SysUserApi = {
  list: (params?: { deptId?: number; userName?: string; phonenumber?: string; status?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.deptId) sp.set("deptId", String(params.deptId));
    if (params?.userName) sp.set("userName", params.userName);
    if (params?.phonenumber) sp.set("phonenumber", params.phonenumber);
    if (params?.status) sp.set("status", params.status);
    sp.set("page", String(params?.page ?? 1));
    sp.set("pageSize", String(params?.pageSize ?? 20));
    return api<{ items: SysUserItem[]; total: number; page: number; pageSize: number }>(`/sys-user/list?${sp}`);
  },
  simpleList: (params?: { userName?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.userName) sp.set("userName", params.userName);
    sp.set("page", String(params?.page ?? 1));
    sp.set("pageSize", String(params?.pageSize ?? 50));
    return api<{ items: { userId: number; userName: string; nickName: string }[]; total: number; page: number; pageSize: number }>(`/sys-user/simple-list?${sp}`);
  },
  get: (id: number) => api<SysUserItem>(`/sys-user/${id}`),
  create: async (body: Record<string, unknown>) => {
    if (body.password) body.password = await encryptPassword(body.password as string);
    return api<SysUserItem>("/sys-user", { method: "POST", body: JSON.stringify(body) });
  },
  patch: async (id: number, body: Record<string, unknown>) => {
    if (body.password) body.password = await encryptPassword(body.password as string);
    return api<SysUserItem>(`/sys-user/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  },
  remove: (id: number) => api<void>(`/sys-user/${id}`, { method: "DELETE" }),
  resetPwd: async (id: number, password: string) => {
    const encPwd = await encryptPassword(password);
    return api<{ ok: boolean }>(`/sys-user/${id}/resetPwd`, { method: "PATCH", body: JSON.stringify({ password: encPwd }) });
  },
  changeStatus: (id: number, status: string) =>
    api<{ ok: boolean }>(`/sys-user/${id}/changeStatus`, { method: "PATCH", body: JSON.stringify({ status }) }),
  roles: () => api<{ role_id: number; role_name: string; role_key: string; status: string }[]>(`/sys-user/roles`),
};

// ── 参数设置 API ──

export type ConfigItem = {
  configId: number;
  configName: string;
  configKey: string;
  configValue: string;
  configType: string;
  createBy: string;
  createTime: string;
  updateBy: string;
  updateTime: string;
  remark: string;
};

export const SysConfigApi = {
  list: (params?: { configName?: string; configKey?: string; configType?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.configName) sp.set("configName", params.configName);
    if (params?.configKey) sp.set("configKey", params.configKey);
    if (params?.configType) sp.set("configType", params.configType);
    sp.set("page", String(params?.page ?? 1));
    sp.set("pageSize", String(params?.pageSize ?? 20));
    return api<{ items: ConfigItem[]; total: number; page: number; pageSize: number }>(`/sys-config/list?${sp}`);
  },
  get: (id: number) => api<ConfigItem>(`/sys-config/${id}`),
  getByKey: (key: string) => api<ConfigItem>(`/sys-config/key/${key}`),
  create: (body: Record<string, unknown>) =>
    api<ConfigItem>("/sys-config", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: Record<string, unknown>) =>
    api<ConfigItem>(`/sys-config/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/sys-config/${id}`, { method: "DELETE" }),
};

// ── 通知公告 API ──

export type NoticeItem = {
  noticeId: number;
  noticeTitle: string;
  noticeType: string;
  noticeContent: string;
  status: string;
  createBy: string;
  createTime: string;
  updateBy: string;
  updateTime: string;
  remark: string;
};

export const SysNoticeApi = {
  list: (params?: { noticeTitle?: string; noticeType?: string; status?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.noticeTitle) sp.set("noticeTitle", params.noticeTitle);
    if (params?.noticeType) sp.set("noticeType", params.noticeType);
    if (params?.status) sp.set("status", params.status);
    sp.set("page", String(params?.page ?? 1));
    sp.set("pageSize", String(params?.pageSize ?? 20));
    return api<{ items: NoticeItem[]; total: number; page: number; pageSize: number }>(`/sys-notice/list?${sp}`);
  },
  get: (id: number) => api<NoticeItem>(`/sys-notice/${id}`),
  create: (body: Record<string, unknown>) =>
    api<NoticeItem>("/sys-notice", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: Record<string, unknown>) =>
    api<NoticeItem>(`/sys-notice/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/sys-notice/${id}`, { method: "DELETE" }),
};

// ── 操作日志 API ──

export type OperLogItem = {
  operId: number;
  title: string;
  logType: string;
  businessType: number;
  method: string;
  requestMethod: string;
  operUrl: string;
  operIp: string;
  operLocation: string;
  operParam: string;
  jsonResult: string;
  status: number;
  errorMsg: string;
  operUserName: string;
  operTime: string;
  costTime: number;
};

export const SysOperLogApi = {
  list: (params?: { title?: string; logType?: string; operUserName?: string; status?: number; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.title) sp.set("title", params.title);
    if (params?.logType) sp.set("logType", params.logType);
    if (params?.operUserName) sp.set("operUserName", params.operUserName);
    if (params?.status !== undefined) sp.set("status", String(params.status));
    sp.set("page", String(params?.page ?? 1));
    sp.set("pageSize", String(params?.pageSize ?? 20));
    return api<{ items: OperLogItem[]; total: number; page: number; pageSize: number }>(`/sys-operlog/list?${sp}`);
  },
  get: (id: number) => api<OperLogItem>(`/sys-operlog/${id}`),
  remove: (id: number) => api<void>(`/sys-operlog/${id}`, { method: "DELETE" }),
  clean: () => api<void>(`/sys-operlog/clean`, { method: "DELETE" }),
  exportUrl: () => `${API_BASE}/sys-operlog/export`,
};

// ── 会议申请审批 API ──

export type MeetingAppItem = {
  appId: number;
  title: string;
  applicantId: number;
  meetingTime: string;
  endTime: string;
  location: string;
  deptCount: number;
  priority: "高" | "中" | "低";
  status: "pending" | "approved" | "rejected";
  approverId: number | null;
  approveTime: string;
  meetingId: number | null;
  createdAt: string;
  remark: string;
};

export const MeetingAppApi = {
  list: (params?: { status?: string; priority?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    if (params?.priority) sp.set("priority", params.priority);
    sp.set("page", String(params?.page ?? 1));
    sp.set("pageSize", String(params?.pageSize ?? 20));
    return api<{ items: MeetingAppItem[]; total: number; page: number; pageSize: number }>(`/meeting-applications/list?${sp}`);
  },
  get: (id: number) => api<MeetingAppItem>(`/meeting-applications/${id}`),
  create: (body: { title: string; meetingTime: string; endTime?: string; location?: string; deptCount?: number; priority?: string; remark?: string }) =>
    api<{ appId: number; status: string }>("/meeting-applications", { method: "POST", body: JSON.stringify(body) }),
  approve: (id: number, body: { approved: boolean; rejectReason?: string }) =>
    api<{ appId: number; status: string }>(`/meeting-applications/${id}/approve`, { method: "PATCH", body: JSON.stringify(body) }),
  start: (id: number) =>
    api<{ meetingId: number; code: string; title: string }>(`/meeting-applications/${id}/start`, { method: "POST", body: JSON.stringify({}) }),
};

// ── 用户操作审批 API ──

export type UserApprovalItem = {
  approvalId: number;
  requestType: "create" | "update" | "delete" | "resetPwd";
  targetUserId: number | null;
  requesterId: number;
  requesterData: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected" | "execution_failed";
  approverId: number | null;
  approveTime: string;
  rejectReason: string;
  createTime: string;
};

export const UserApprovalApi = {
  list: (params?: { status?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    sp.set("page", String(params?.page ?? 1));
    sp.set("pageSize", String(params?.pageSize ?? 20));
    return api<{ items: UserApprovalItem[]; total: number; page: number; pageSize: number }>(`/sys-user-approval/list?${sp}`);
  },
  get: (id: number) => api<UserApprovalItem>(`/sys-user-approval/${id}`),
  create: (body: { requestType: string; targetUserId?: number | null; requestData?: Record<string, unknown> }) =>
    api<{ approvalId: number; status: string }>("/sys-user-approval", { method: "POST", body: JSON.stringify(body) }),
  approve: (id: number, body: { approved: boolean; rejectReason?: string }) =>
    api<{ approvalId: number; status: string }>(`/sys-user-approval/${id}/approve`, { method: "PATCH", body: JSON.stringify(body) }),
};

// ── 群组管理 API ──

export type MeetingGroupItem = {
  groupId: number;
  groupName: string;
  memberCount: number;
  createdAt: string;
};

export type MeetingGroupDetail = {
  groupId: number;
  groupName: string;
  members: {
    userId: number;
    userName: string;
    nickName: string;
    deptId: number | null;
    deptName: string | null;
  }[];
  deptMembers: { deptId: number; deptName: string; userCount: number }[];
};

export const MeetingGroupApi = {
  list: (params?: { groupName?: string }) => {
    const sp = new URLSearchParams();
    if (params?.groupName) sp.set("groupName", params.groupName);
    return api<{ items: MeetingGroupItem[] }>(`/meeting-groups?${sp}`);
  },
  get: (id: number) => api<MeetingGroupDetail>(`/meeting-groups/${id}`),
  create: (body: { groupName: string; memberUserIds?: number[]; memberDeptIds?: number[] }) =>
    api<MeetingGroupDetail>("/meeting-groups", { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: {
    groupName?: string;
    addUserIds?: number[];
    removeUserIds?: number[];
    addDeptIds?: number[];
    removeDeptIds?: number[];
  }) => api<{ groupId: number; groupName: string; memberCount: number }>(
    `/meeting-groups/${id}`, { method: "PATCH", body: JSON.stringify(body) }
  ),
  remove: (id: number) => api<void>(`/meeting-groups/${id}`, { method: "DELETE" }),
  quickStart: (id: number, body?: { title?: string; waitingRoomEnabled?: boolean }) =>
    api<{ meetingId: number; code: string; title: string; invitedCount: number }>(
      `/meeting-groups/${id}/quick-start`, { method: "POST", body: JSON.stringify(body ?? {}) }
    ),
};

// ── 会议邀请名单 ──
export type InvitationItem = {
  id: number;
  meetingId: number;
  userId: number | null;
  deptId: number | null;
  displayName: string;
  status: string;
  invitedAt: string;
  joinedAt: string;
};

export type MeetingOnlineInfo = {
  meetingId: number;
  code: string;
  title: string;
  status: string;
  onlineCount: number;
  invitedCount: number;
};

export type AttendeeDetail = {
  displayName: string;
  status: string;
  joinedAt: string | null;
  deptId: number | null;
  deptName: string | null;
};

export const InvitationApi = {
  list: (meetingId: number) =>
    api<{ items: InvitationItem[] }>(`/meetings/${meetingId}/invitations`),
  invite: (meetingId: number, body: { userIds?: number[]; deptIds?: number[] }) =>
    api<{ meetingId: number; invited: number }>(`/meetings/${meetingId}/invite`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  attendees: (meetingId: number) =>
    api<{ items: { peerId: string; displayName: string; role: string; handRaised: boolean }[] }>(
      `/meetings/${meetingId}/attendees`
    ),
  onlineMeetings: () =>
    api<{ items: MeetingOnlineInfo[] }>(`/admin/meetings/online`),
  attendeeDetail: (meetingId: number) =>
    api<{ items: AttendeeDetail[] }>(`/admin/meetings/${meetingId}/attendees`),
  updateStatus: (meetingId: number, invId: number, status: "accepted" | "rejected" | "pending") =>
    api<{ id: number; status: string }>(`/meetings/${meetingId}/invitations/${invId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
};
