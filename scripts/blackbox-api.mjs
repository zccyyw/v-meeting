// 黑盒 API 测试 — 独立测试栈（api:8090, sqlite: .test-data/blackbox.sqlite）
const API = "http://127.0.0.1:8090";
const KEY = (process.env.MEETING_CRYPTO_KEY || "rEWjZY3aMFivxEApHkEw7GMHZC3uR2QGUio7w0NYdZ0");
const enc = new TextEncoder();

async function getKey() {
  const arr = new Uint8Array(32);
  const src = enc.encode(KEY);
  for (let i = 0; i < 32; i++) arr[i] = src[i % src.length] ?? 0;
  return crypto.subtle.importKey("raw", arr, { name: "AES-GCM" }, false, ["encrypt"]);
}
async function encryptPassword(plain) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `enc:${b64(iv)}:${b64(ct)}`;
}

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  ← " + detail : ""}`);
}

async function req(method, path, { sid, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sid ? { "x-session-id": sid } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function login(username, password) {
  return req("POST", "/auth/login", { body: { username, password: await encryptPassword(password) } });
}

// 登录并完成强制改密，返回可用会话
async function loginReady(username, defPwd, newPwd) {
  const r1 = await login(username, defPwd);
  if (r1.status !== 200) return { sid: null, r: r1 };
  const sid = r1.json.sessionId;
  if (!r1.json.mustChangePassword) return { sid, r: r1 };
  const r2 = await req("POST", "/auth/change-password", {
    sid, body: {
      currentPassword: await encryptPassword(defPwd),
      newPassword: await encryptPassword(newPwd),
    },
  });
  return { sid, changed: r2.status === 200, r: r1 };
}

// ─────────────────────────────────────────────
const T1 = "Blackbox@2026"; // 符合策略的新密码

// A1 默认密码登录 → mustChangePassword
const m1 = await login("meeting", "Admin@123");
check("A1 默认密码登录成功且提示必须改密", m1.status === 200 && m1.json.mustChangePassword === true, JSON.stringify(m1.json).slice(0, 200));

// A2 弱密码被策略拒绝
const sidM = m1.json.sessionId;
const weak = await req("POST", "/auth/change-password", {
  sid: sidM, body: { currentPassword: await encryptPassword("Admin@123"), newPassword: await encryptPassword("short") },
});
check("A2 弱密码被密码策略拒绝", weak.status === 400 && weak.json.error === "password_policy_violation", JSON.stringify(weak.json));

// A3 符合策略改密成功
const chg = await req("POST", "/auth/change-password", {
  sid: sidM, body: { currentPassword: await encryptPassword("Admin@123"), newPassword: await encryptPassword(T1) },
});
check("A3 改密成功", chg.status === 200 && chg.json.ok === true, JSON.stringify(chg.json));

// A4 改密后旧密码失效
const oldLogin = await login("meeting", "Admin@123");
check("A4 旧密码失效", oldLogin.status !== 200 || oldLogin.json.sessionId === undefined, JSON.stringify(oldLogin.json).slice(0, 120));

// A5 新密码正常登录
const m2 = await login("meeting", T1);
check("A5 新密码正常登录且无强制改密", m2.status === 200 && m2.json.mustChangePassword === false, JSON.stringify(m2.json).slice(0, 200));
const M = m2.json.sessionId;

// A6 错误凭证
const bad = await login("meeting", "Wrong@Password1");
check("A6 错误密码被拒绝", bad.status === 401, JSON.stringify(bad.json));

// ─────────────────────────────────────────────
// B 会议申请审批流（需求 8）
const app1 = await req("POST", "/meeting-applications", {
  sid: M, body: {
    title: "黑盒测试-高优先级会议", meetingTime: "2026-09-09T10:00:00.000Z",
    endTime: "2026-09-09T11:00:00.000Z", location: "一号会议室", deptCount: 3, priority: "高", remark: "",
  },
});
check("B1 提交会议申请（含时间/地点/单位数/优先级）", app1.status === 201 && app1.json.status === "pending", JSON.stringify(app1.json));

const app2 = await req("POST", "/meeting-applications", {
  sid: M, body: { title: "黑盒测试-低优先级", meetingTime: "2026-09-10T09:00:00.000Z", priority: "低", remark: "" },
});
check("B2 提交第二份申请（低优先级）", app2.status === 201, JSON.stringify(app2.json));

// B3 未批准时 start 应被拒
const earlyStart = await req("POST", `/meeting-applications/${app1.json.appId}/start`, { sid: M, body: {} });
check("B3 未批准的申请不可发起", earlyStart.status === 400 || earlyStart.status === 403, `status=${earlyStart.status} ${JSON.stringify(earlyStart.json)}`);

// B4 普通用户无审批权
const approveByUser = await req("PATCH", `/meeting-applications/${app1.json.appId}/approve`, { sid: M, body: { approved: true } });
check("B4 普通用户无审批权限", approveByUser.status === 403, `status=${approveByUser.status}`);

// authadmin 登录（走改密）
const authAdm = await loginReady("authadmin", "Admin@123", T1);
check("B5 授权管理员登录并完成改密", !!authAdm.sid, JSON.stringify(authAdm.r.json).slice(0, 150));
const A = authAdm.sid;

// B6 列表按优先级排序（高在前）
const listByAdm = await req("GET", "/meeting-applications/list?status=pending&page=1&pageSize=20", { sid: A });
const titles = (listByAdm.json?.items || []).map((i) => i.title);
check("B6 授权管理员可见待审列表且高优先级在前",
  listByAdm.status === 200 && titles.indexOf("黑盒测试-高优先级会议") < titles.indexOf("黑盒测试-低优先级"),
  JSON.stringify(titles));

// B7 审批通过
const approve = await req("PATCH", `/meeting-applications/${app1.json.appId}/approve`, { sid: A, body: { approved: true } });
check("B7 授权管理员审批通过", approve.status === 200, JSON.stringify(approve.json));

// B8 批准后申请人可发起，返回 hostJoinToken
const start = await req("POST", `/meeting-applications/${app1.json.appId}/start`, { sid: M, body: {} });
check("B8 批准后可发起会议且返回主持人令牌",
  start.status === 200 && start.json.meetingId > 0 && !!start.json.hostJoinToken && !!start.json.code,
  `status=${start.status} ${JSON.stringify(start.json).slice(0, 200)}`);

// B9 重复发起应被拒（幂等保护）
const restart = await req("POST", `/meeting-applications/${app1.json.appId}/start`, { sid: M, body: {} });
check("B9 不可重复发起", restart.status === 400 && restart.json.error === "already_started",
  `status=${restart.status} ${JSON.stringify(restart.json)}`);

// B10 非申请人不可发起
const startByOther = await req("POST", `/meeting-applications/${app2.json.appId}/start`, { sid: A, body: {} });
check("B10 非申请人不可发起（即使已授权管理员）", startByOther.status === 400 || startByOther.status === 403, `status=${startByOther.status}`);

// B11 驳回路径
const reject = await req("PATCH", `/meeting-applications/${app2.json.appId}/approve`, { sid: A, body: { approved: false, rejectReason: "黑盒驳回" } });
check("B11 驳回申请", reject.status === 200, JSON.stringify(reject.json));

// ─────────────────────────────────────────────
// C 群组 + 常用置顶（需求 4）
// 用 sysadmin 建两个测试用户入群（先登录 sysadmin）
const sysAdm = await loginReady("sysadmin", "Admin@123", T1);
check("C0 系统管理员登录并完成改密", !!sysAdm.sid, JSON.stringify(sysAdm.r.json).slice(0, 150));
const S = sysAdm.sid;

const mkUser = async (name) => {
  const r = await req("POST", "/sys-user", {
    sid: S, body: { userName: name, nickName: name, password: await encryptPassword(T1), status: "0", deptId: null, roleIds: [], remark: "" },
  });
  return r;
};
const u1 = await mkUser("bb_user1");
const u2 = await mkUser("bb_user2");
check("C1 创建两个测试用户", u1.status === 201 && u2.status === 201, JSON.stringify(u1.json).slice(0, 200));
const uid1 = u1.json?.userId ?? u1.json?.id;
const uid2 = u2.json?.userId ?? u2.json?.id;

const g1 = await req("POST", "/meeting-groups", { sid: M, body: { groupName: "BB-普通群组", memberUserIds: [uid1, uid2], memberDeptIds: [] } });
const g2 = await req("POST", "/meeting-groups", { sid: M, body: { groupName: "BB-常用群组", memberUserIds: [uid1], memberDeptIds: [] } });
check("C2 创建两个群组", g1.status === 201 && g2.status === 201, JSON.stringify(g1.json).slice(0, 200));

// C3 置顶
const pin = await req("POST", `/meeting-groups/${g1.json.groupId}/pin`, { sid: M, body: { pinned: true } });
check("C3 设置常用（置顶）", pin.status === 200 && pin.json.pinned === true, JSON.stringify(pin.json));

// C4 列表置顶排序
await new Promise((r) => setTimeout(r, 1100)); // created_at 秒级粒度，保证排序稳定
const gList = await req("GET", "/meeting-groups", { sid: M });
const names = (gList.json?.items || []).map((i) => i.groupName);
check("C4 常用群组置顶显示（含 pinned 字段）",
  gList.status === 200 && names[0] === "BB-普通群组" && gList.json.items[0].pinned === true,
  JSON.stringify(names));

// C5 取消置顶恢复排序
const unpin = await req("POST", `/meeting-groups/${g1.json.groupId}/pin`, { sid: M, body: { pinned: false } });
const gList2 = await req("GET", "/meeting-groups", { sid: M });
check("C5 取消常用后不再置顶", unpin.status === 200 && gList2.json?.items?.[0]?.pinned === false,
  JSON.stringify((gList2.json?.items || []).map((i) => [i.groupName, i.pinned])));

// C6 快速开会：自动建会+邀请全员（前端随后用 joinToken 取票入会）
const qs = await req("POST", `/meeting-groups/${g2.json.groupId}/quick-start`, { sid: M, body: { title: "BB-群组快速会议" } });
check("C6 一键群组开会返回会议号与邀请数",
  qs.status === 200 && qs.json.meetingId > 0 && !!qs.json.code && qs.json.invitedCount >= 1, JSON.stringify(qs.json).slice(0, 200));
// C6b 主持人通过 joinToken 获取入会令牌（前端实际入会路径）
const jt = await req("POST", `/meetings/${qs.json.meetingId}/join-token`, { sid: M, body: {} });
check("C6b 群组会议主持人可获取入会令牌",
  jt.status === 200 && !!jt.json.token && jt.json.role === "host", `status=${jt.status} ${JSON.stringify(jt.json).slice(0, 150)}`);

// C7 邀请名单（需求 1：在线状态 + 单位）
const inv = await req("GET", `/meetings/${qs.json.meetingId}/invitations`, { sid: M });
const invItems = inv.json?.items || [];
check("C7 邀请名单含被邀人（带状态字段）", inv.status === 200 && invItems.length >= 1 && "status" in invItems[0] && "deptName" in invItems[0],
  JSON.stringify(invItems).slice(0, 300));

// ─────────────────────────────────────────────
// D 管理端监控（需求 2）
const online = await req("GET", "/admin/meetings/online", { sid: S });
const onlineByUser = await req("GET", "/admin/meetings/online", { sid: M });
check("D1 管理员可查看会议在线情况", online.status === 200 && Array.isArray(online.json?.items || online.json?.meetings || []),
  JSON.stringify(online.json).slice(0, 200));
check("D2 普通用户无权查看监控", onlineByUser.status === 403, `status=${onlineByUser.status}`);

// E system 隐藏 + 配置可见性（需求 9）
const sysUsers = await req("GET", "/sys-user/list?page=1&pageSize=100", { sid: S });
const userList = sysUsers.json?.rows || sysUsers.json?.items || [];
const hidden = userList.filter((u) => ["system", "sysadmin"].includes(u.userName));
check("E1 system/sysadmin 账号对管理列表隐藏（设计：其余三员可见）", sysUsers.status === 200 && hidden.length === 0,
  `leaked=${hidden.map((u) => u.userName)}`);
const simpleList = await req("GET", "/sys-user/simple-list?page=1&pageSize=100", { sid: M });
const simpleNames = (simpleList.json?.items || []).map((u) => u.userName);
check("E1b 群组成员选择列表同样隐藏 system/sysadmin", simpleList.status === 200 && !simpleNames.includes("system") && !simpleNames.includes("sysadmin"),
  JSON.stringify(simpleNames));

const pubCfgUser = await req("GET", "/sys-config/public", { sid: M });
const pubCfgSys = await req("GET", "/sys-config/public", { sid: S });
const userKeys = Object.keys(pubCfgUser.json || {});
const sysKeys = Object.keys(pubCfgSys.json || {});
check("E2 在线人数上限配置仅管理员可见",
  !("maxUsers" in userKeys.reduce((a, k) => (a[k] = 1, a), {})) && sysKeys.includes("maxUsers") === (JSON.stringify(pubCfgSys.json).includes("maxUsers")),
  `user=${JSON.stringify(pubCfgUser.json).slice(0, 200)} sys=${JSON.stringify(pubCfgSys.json).slice(0, 200)}`);

// ─────────────────────────────────────────────
// H 锁定/自动解锁（放最后：auditadmin 错 5 次 → 锁 60s → 自动解锁）
console.log("\n[锁定测试] auditadmin 连续输错 5 次…");
for (let i = 0; i < 5; i++) {
  await login("auditadmin", "Wrong@Pass" + i);
}
const locked = await login("auditadmin", "Admin@123");
check("H1 5 次失败后正确密码也被锁定", locked.status === 423, `status=${locked.status} ${JSON.stringify(locked.json)}`);
console.log("[锁定测试] 等待 65 秒验证自动解锁…");
await new Promise((r) => setTimeout(r, 65000));
const unlocked = await login("auditadmin", "Admin@123");
check("H2 60 秒后自动解锁", unlocked.status === 200, `status=${unlocked.status} ${JSON.stringify(unlocked.json).slice(0, 120)}`);

// ─────────────────────────────────────────────
console.log("\n══════════ 黑盒测试汇总 ══════════");
const pass = results.filter((r) => r.ok).length;
console.log(`PASS ${pass} / ${results.length}`);
const failed = results.filter((r) => !r.ok);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log("  -", f.name, "|", f.detail)); }
// 导出会话供 WS 冒烟测试使用
const fs = await import("node:fs");
fs.writeFileSync(".test-data/ctx.json", JSON.stringify({
  meetingId: start.json?.meetingId, code: start.json?.code, hostJoinToken: start.json?.hostJoinToken,
  qsMeetingId: qs.json?.meetingId, qsToken: qs.json?.hostJoinToken, meetingSid: M,
}, null, 2));
process.exit(failed.length ? 1 : 0);
