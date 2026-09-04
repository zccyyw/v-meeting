// System functional test script - API level
const http = require('http');
const fs = require('fs');

const API_HOST = '127.0.0.1';
const API_PORT = 8080;
const results = [];

function apiCall(method, path, body, sessionId) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (sessionId) headers['x-session-id'] = sessionId;
    
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: path,
      method: method,
      headers: headers,
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ statusCode: res.statusCode, body: data, json: parsed });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function login(username, password) {
  const r = await apiCall('POST', '/auth/login', { username, password });
  return r;
}

async function getStatusCode(resp) {
  return resp.statusCode;
}

async function main() {
  // ============================================================
  // 一、登录认证模块
  // ============================================================
  console.log('\n===== 登录认证模块 =====');

  // TC-AUTH-001
  let r = await login('test1', '123456');
  let code = r.statusCode;
  let mcp = r.json?.mustChangePassword;
  results.push({ id: 'TC-AUTH-001', pass: code === 200, code, detail: `test1 login, mustChangePassword=${mcp}` });

  // TC-AUTH-002
  r = await login('sysadmin', 'Admin@123');
  code = r.statusCode;
  mcp = r.json?.mustChangePassword;
  results.push({ id: 'TC-AUTH-002', pass: code === 200 && mcp === true, code, detail: `sysadmin login, mustChangePassword=${mcp}` });

  // TC-AUTH-003
  r = await login('nonexistent', '123456');
  code = r.statusCode;
  results.push({ id: 'TC-AUTH-003', pass: code === 401, code, detail: 'nonexistent user' });

  // TC-AUTH-004
  r = await login('test1', 'wrongpwd');
  code = r.statusCode;
  results.push({ id: 'TC-AUTH-004', pass: code === 401, code, detail: 'wrong password' });

  // TC-AUTH-005: 5次失败后锁定
  for (let i = 0; i < 5; i++) { await login('test2', 'wrong'); }
  r = await login('test2', '123456');
  code = r.statusCode;
  results.push({ id: 'TC-AUTH-005', pass: code === 423, code, detail: '5 fails then lock' });

  // TC-AUTH-007: 3次失败后成功
  for (let i = 0; i < 3; i++) { await login('test3', 'wrong'); }
  r = await login('test3', '123456');
  code = r.statusCode;
  results.push({ id: 'TC-AUTH-007', pass: code === 200, code, detail: '3 fails then success (counter reset)' });

  // TC-AUTH-010: 空用户名
  r = await apiCall('POST', '/auth/login', { username: '', password: '123456' });
  code = r.statusCode;
  results.push({ id: 'TC-AUTH-010a', pass: code === 400, code, defect: code === 500, detail: 'empty username' });

  // TC-AUTH-010: 空密码
  r = await apiCall('POST', '/auth/login', { username: 'test1', password: '' });
  code = r.statusCode;
  results.push({ id: 'TC-AUTH-010b', pass: code === 400, code, defect: code === 500, detail: 'empty password' });

  // TC-AUTH-011: system 隐藏用户
  r = await login('system', 'system123');
  code = r.statusCode;
  let hasAdmin = r.json?.roles?.includes('admin');
  results.push({ id: 'TC-AUTH-011', pass: code === 200 && hasAdmin, code, detail: `system login, roles=${r.json?.roles?.join(',')}` });

  // ============================================================
  // 二、密码策略模块 (使用 test4)
  // ============================================================
  console.log('===== 密码策略模块 =====');
  r = await login('test4', '123456');
  const sid = r.json?.sessionId || '';

  // TC-PWD-001: 修改密码成功
  r = await apiCall('POST', '/auth/change-password', { currentPassword: '123456', newPassword: 'Abcdef@123' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-001', pass: code === 200 && r.json?.ok === true, code, detail: 'change pwd success' });

  // TC-PWD-002: 密码长度不足
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcdef@123', newPassword: 'Ab1@' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-002', pass: code === 400, code, detail: 'short pwd (4 chars)' });

  // TC-PWD-003: 恰好8字符
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcdef@123', newPassword: 'Abcd@123' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-003', pass: code === 200, code, detail: 'exactly 8 chars' });

  // TC-PWD-004: 缺大写
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'abcd@123' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-004', pass: code === 400, code, detail: 'no uppercase' });

  // TC-PWD-005: 缺小写
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'ABCD@123' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-005', pass: code === 400, code, detail: 'no lowercase' });

  // TC-PWD-006: 缺数字
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'Abcd@efg' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-006', pass: code === 400, code, detail: 'no digit' });

  // TC-PWD-007: 缺特殊字符
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'Abcdefg123' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-007', pass: code === 400, code, detail: 'no special char' });

  // TC-PWD-008: 原密码错误
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'wrongpwd', newPassword: 'Abcd@123' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-008', pass: code === 400, code, detail: 'wrong current pwd' });

  // TC-PWD-009: 新旧相同
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'Abcd@123' }, sid);
  code = r.statusCode;
  results.push({ id: 'TC-PWD-009', pass: code === 400, code, detail: 'same as old' });

  // ============================================================
  // 三、三员权限模块
  // ============================================================
  console.log('===== 三员权限模块 =====');

  // TC-ROLE-005: 普通用户不能查看审计日志
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=5', null, sid);
  code = r.statusCode;
  results.push({ id: 'TC-ROLE-005', pass: code === 403, code, detail: 'common user cannot view operlog' });

  // TC-LOG-003: 审计管理员查看日志
  r = await login('auditadmin', 'Admin@123');
  const auditSid = r.json?.sessionId || '';
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=5', null, auditSid);
  code = r.statusCode;
  results.push({ id: 'TC-LOG-003', pass: code === 200 && r.json?.items, code, detail: 'auditadmin can view logs' });

  // TC-LOG-004: 授权管理员仅看登录日志
  r = await login('authadmin', 'Admin@123');
  const authSid = r.json?.sessionId || '';
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=100', null, authSid);
  code = r.statusCode;
  const items = r.json?.items || [];
  const hasOperType = items.some(i => i.logType === 'operation');
  results.push({ id: 'TC-LOG-004', pass: code === 200 && !hasOperType, code, detail: `authadmin only login logs (hasOperation=${hasOperType})` });

  // TC-LOG-005: 系统管理员仅看操作日志
  r = await login('sysadmin', 'Admin@123');
  const sysSid = r.json?.sessionId || '';
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=100', null, sysSid);
  code = r.statusCode;
  const sysItems = r.json?.items || [];
  const hasLoginType = sysItems.some(i => i.logType === 'login');
  results.push({ id: 'TC-LOG-005', pass: code === 200 && !hasLoginType, code, detail: `sysadmin only operation logs (hasLogin=${hasLoginType})` });

  // TC-APPR-004: 系统管理员不能审批
  r = await apiCall('PATCH', '/sys-user-approval/1/approve', { approved: true }, sysSid);
  code = r.statusCode;
  results.push({ id: 'TC-APPR-004', pass: code === 403, code, detail: 'sysadmin cannot approve user ops' });

  // ============================================================
  // 四、群组管理模块 (使用 test1)
  // ============================================================
  console.log('===== 群组管理模块 =====');
  r = await login('test1', '123456');
  const t1Sid = r.json?.sessionId || '';

  // TC-GRP-001: 创建群组
  r = await apiCall('POST', '/meeting-groups', { groupName: 'test-group-api', memberUserIds: [5] }, t1Sid);
  code = r.statusCode;
  let groupId = r.json?.groupId;
  results.push({ id: 'TC-GRP-001', pass: code === 201 && groupId, code, detail: `create group, groupId=${groupId}` });

  // TC-GRP-004: 查看群组列表
  r = await apiCall('GET', '/meeting-groups', null, t1Sid);
  code = r.statusCode;
  results.push({ id: 'TC-GRP-004', pass: code === 200 && r.json?.items, code, detail: 'group list' });

  // TC-GRP-013: 群组名称为空
  r = await apiCall('POST', '/meeting-groups', { groupName: '', memberUserIds: [] }, t1Sid);
  code = r.statusCode;
  results.push({ id: 'TC-GRP-013', pass: code === 400, code, defect: code === 500, detail: 'empty group name' });

  // TC-GRP-015: 群组名称超长(51字符)
  r = await apiCall('POST', '/meeting-groups', { groupName: 'a'.repeat(51), memberUserIds: [] }, t1Sid);
  code = r.statusCode;
  results.push({ id: 'TC-GRP-015', pass: code === 400, code, defect: code === 500, detail: '51 char group name' });

  // ============================================================
  // 五、会议申请审批模块
  // ============================================================
  console.log('===== 会议申请审批模块 =====');

  // TC-APP-001: 提交会议申请
  r = await apiCall('POST', '/meeting-applications', { title: 'test meeting', meetingTime: '2026-09-01 14:00', location: 'room1', deptCount: 3, priority: 'high' }, t1Sid);
  code = r.statusCode;
  let appId = r.json?.appId;
  results.push({ id: 'TC-APP-001', pass: code === 201 && appId, code, defect: code === 500, detail: `submit app, appId=${appId}, body=${r.body.substring(0, 200)}` });

  // TC-APP-007: 普通用户无权审批
  r = await apiCall('PATCH', '/meeting-applications/1/approve', { approved: true }, t1Sid);
  code = r.statusCode;
  results.push({ id: 'TC-APP-007', pass: code === 403, code, detail: 'common user cannot approve' });

  // TC-APP-012: 非法优先级
  r = await apiCall('POST', '/meeting-applications', { title: 'test', meetingTime: '2026-09-01', priority: 'super-high' }, t1Sid);
  code = r.statusCode;
  results.push({ id: 'TC-APP-012', pass: code === 400, code, defect: code === 500, detail: 'invalid priority' });

  // TC-APP-009: 普通用户只看自己申请
  r = await apiCall('GET', '/meeting-applications/list', null, t1Sid);
  code = r.statusCode;
  results.push({ id: 'TC-APP-009', pass: code === 200 && r.json?.items, code, detail: 'user app list' });

  // TC-APP-003: 授权管理员审批通过
  if (appId) {
    r = await apiCall('PATCH', `/meeting-applications/${appId}/approve`, { approved: true }, authSid);
    code = r.statusCode;
    results.push({ id: 'TC-APP-003', pass: code === 200 && r.json?.status === 'approved', code, detail: `approve app, status=${r.json?.status}` });
    
    // TC-APP-010: 重复审批
    r = await apiCall('PATCH', `/meeting-applications/${appId}/approve`, { approved: true }, authSid);
    code = r.statusCode;
    results.push({ id: 'TC-APP-010', pass: code === 400, code, detail: 'duplicate approve' });

    // TC-APP-006: 未审批通过不能发起（use a different pending app）
    // TC-APP-005: 发起已批准的会议
    r = await apiCall('POST', `/meeting-applications/${appId}/start`, {}, t1Sid);
    code = r.statusCode;
    results.push({ id: 'TC-APP-005', pass: code === 200 && r.json?.meetingId, code, detail: `start approved meeting, meetingId=${r.json?.meetingId}` });
  } else {
    results.push({ id: 'TC-APP-003', pass: false, code: 0, detail: 'SKIP - no appId' });
    results.push({ id: 'TC-APP-010', pass: false, code: 0, detail: 'SKIP - no appId' });
    results.push({ id: 'TC-APP-005', pass: false, code: 0, detail: 'SKIP - no appId' });
  }

  // ============================================================
  // 六、system 隐藏用户模块
  // ============================================================
  console.log('===== system 隐藏用户模块 =====');
  r = await login('admin', 'admin123');
  const adminSid = r.json?.sessionId || '';

  // TC-SYS-001: system 用户不可见
  r = await apiCall('GET', '/sys-user/list?page=1&pageSize=100', null, adminSid);
  code = r.statusCode;
  const sysUsers = r.json?.items || r.json?.list || [];
  const hasSystemUser = JSON.stringify(r.body).includes('"userName":"system"') || JSON.stringify(r.body).includes('"user_name":"system"');
  results.push({ id: 'TC-SYS-001', pass: code === 200 && !hasSystemUser, code, detail: `system hidden in user list (found=${hasSystemUser})` });

  // TC-SYS-002: system 用户拥有全部权限
  r = await login('system', 'system123');
  hasAdmin = r.json?.roles?.includes('admin');
  results.push({ id: 'TC-SYS-002', pass: hasAdmin, code: r.statusCode, detail: `system has admin role=${hasAdmin}` });

  // ============================================================
  // 七、会议邀请模块
  // ============================================================
  console.log('===== 会议邀请模块 =====');

  // TC-INV-006: 邀请不存在的用户
  r = await apiCall('POST', '/meetings/1/invite', { userIds: [99999] }, adminSid);
  code = r.statusCode;
  results.push({ id: 'TC-INV-006', pass: code === 200 && r.json?.invited === 0, code, detail: `invite nonexistent user, invited=${r.json?.invited}` });

  // ============================================================
  // 八、综合端到端
  // ============================================================
  console.log('===== 综合端到端 =====');

  // TC-E2E-005: 安全合规端到端 - 锁定
  for (let i = 0; i < 5; i++) { await login('test5', 'wrong'); }
  r = await login('test5', '123456');
  code = r.statusCode;
  results.push({ id: 'TC-E2E-005', pass: code === 423, code, detail: '5 fails then lock' });

  // ============================================================
  // 输出结果
  // ============================================================
  console.log('\n==================== 测试结果汇总 ====================\n');
  let passCount = 0, failCount = 0, defectCount = 0, skipCount = 0;
  for (const r of results) {
    if (r.pass === null || r.pass === undefined) { skipCount++; continue; }
    const status = r.pass ? '✓ PASS' : (r.defect ? '✗ DEFECT' : '✗ FAIL');
    if (r.pass) passCount++;
    else if (r.defect) defectCount++;
    else failCount++;
    console.log(`${status} | ${r.id} | HTTP ${r.code} | ${r.detail}`);
  }
  console.log('');
  console.log(`总计: PASS=${passCount}  FAIL=${failCount}  DEFECT=${defectCount}  SKIP=${skipCount}  总用例=${results.length}`);
  
  // Save results to JSON
  fs.writeFileSync('d:/workspace/aitools/cursor/meeting/scripts/test-results.json', JSON.stringify(results, null, 2));
  console.log('\n详细结果已保存到 scripts/test-results.json');
}

main().catch(err => { console.error('Test script error:', err); process.exit(1); });
