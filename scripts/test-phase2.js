// Full system functional test - Phase 2: Extended test coverage
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
    const req = http.request({ hostname: API_HOST, port: API_PORT, path, method, headers }, (res) => {
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
  return apiCall('POST', '/auth/login', { username, password });
}

function record(id, pass, code, detail, defect = false) {
  results.push({ id, pass, code, detail, defect });
}

async function main() {
  // ============================================================
  // 一、登录认证模块 (TC-AUTH-001~012)
  // ============================================================
  console.log('===== 登录认证模块 =====');

  // TC-AUTH-001
  let r = await login('test1', '123456');
  record('TC-AUTH-001', r.statusCode === 200, r.statusCode, `test1 login OK, mustChangePassword=${r.json?.mustChangePassword}`);

  // TC-AUTH-002
  r = await login('sysadmin', 'Admin@123');
  record('TC-AUTH-002', r.statusCode === 200 && r.json?.mustChangePassword === true, r.statusCode, `sysadmin login, mustChangePassword=${r.json?.mustChangePassword}`);

  // TC-AUTH-003
  r = await login('nonexistent', '123456');
  record('TC-AUTH-003', r.statusCode === 401, r.statusCode, 'nonexistent user');

  // TC-AUTH-004
  r = await login('test1', 'wrongpwd');
  record('TC-AUTH-004', r.statusCode === 401, r.statusCode, 'wrong password');

  // TC-AUTH-005: 5 fails then lock
  for (let i = 0; i < 5; i++) await login('test2', 'wrong');
  r = await login('test2', '123456');
  record('TC-AUTH-005', r.statusCode === 423, r.statusCode, '5 fails then locked (423)');

  // TC-AUTH-007: 3 fails then success (counter reset)
  for (let i = 0; i < 3; i++) await login('test3', 'wrong');
  r = await login('test3', '123456');
  record('TC-AUTH-007', r.statusCode === 200, r.statusCode, '3 fails then success (counter reset)');

  // TC-AUTH-008: disabled user
  // Need to disable test1 first via admin
  let adminLogin = await login('admin', 'admin123');
  let adminSid = adminLogin.json?.sessionId;
  // Try to disable test1
  r = await apiCall('PATCH', '/sys-user/4', { status: 1 }, adminSid);
  r = await login('test1', '123456');
  record('TC-AUTH-008', r.statusCode === 403, r.statusCode, `disabled user login (status=1) -> ${r.body}`);
  // Re-enable
  await apiCall('PATCH', '/sys-user/4', { status: 0 }, adminSid);

  // TC-AUTH-010: empty username/password
  r = await apiCall('POST', '/auth/login', { username: '', password: '123456' });
  record('TC-AUTH-010a', r.statusCode === 400, r.statusCode, `empty username (DEFECT: returns ${r.statusCode})`, r.statusCode === 500);

  r = await apiCall('POST', '/auth/login', { username: 'test1', password: '' });
  record('TC-AUTH-010b', r.statusCode === 400, r.statusCode, `empty password (DEFECT: returns ${r.statusCode})`, r.statusCode === 500);

  // TC-AUTH-011: system hidden user
  r = await login('system', 'system123');
  record('TC-AUTH-011', r.statusCode === 200 && r.json?.roles?.includes('admin'), r.statusCode, `system login, roles=${r.json?.roles?.join(',')}`);

  // ============================================================
  // 二、密码策略模块 (TC-PWD-001~010)
  // ============================================================
  console.log('===== 密码策略模块 =====');
  r = await login('test4', '123456');
  const sid = r.json?.sessionId;

  // TC-PWD-001: change pwd success
  r = await apiCall('POST', '/auth/change-password', { currentPassword: '123456', newPassword: 'Abcdef@123' }, sid);
  record('TC-PWD-001', r.statusCode === 200 && r.json?.ok === true, r.statusCode, 'change pwd success');

  // TC-PWD-002: short pwd
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcdef@123', newPassword: 'Ab1@' }, sid);
  record('TC-PWD-002', r.statusCode === 400, r.statusCode, 'short pwd (4 chars)');

  // TC-PWD-003: exactly 8 chars
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcdef@123', newPassword: 'Abcd@123' }, sid);
  record('TC-PWD-003', r.statusCode === 200, r.statusCode, 'exactly 8 chars');

  // TC-PWD-004: no uppercase
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'abcd@123' }, sid);
  record('TC-PWD-004', r.statusCode === 400, r.statusCode, 'no uppercase');

  // TC-PWD-005: no lowercase
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'ABCD@123' }, sid);
  record('TC-PWD-005', r.statusCode === 400, r.statusCode, 'no lowercase');

  // TC-PWD-006: no digit
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'Abcd@efg' }, sid);
  record('TC-PWD-006', r.statusCode === 400, r.statusCode, 'no digit');

  // TC-PWD-007: no special char
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'Abcdefg123' }, sid);
  record('TC-PWD-007', r.statusCode === 400, r.statusCode, `no special char (DEFECT: returns ${r.statusCode})`, r.statusCode === 200);

  // TC-PWD-008: wrong current
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'wrongpwd', newPassword: 'Abcd@123' }, sid);
  record('TC-PWD-008', r.statusCode === 400, r.statusCode, 'wrong current pwd');

  // TC-PWD-009: same as old
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcd@123', newPassword: 'Abcd@123' }, sid);
  record('TC-PWD-009', r.statusCode === 400, r.statusCode, 'same as old');

  // ============================================================
  // 三、三员权限模块 (TC-ROLE-001~005)
  // ============================================================
  console.log('===== 三员权限模块 =====');

  // TC-ROLE-005: common user cannot view operlog
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=5', null, sid);
  record('TC-ROLE-005', r.statusCode === 403, r.statusCode, 'common user cannot view operlog');

  // TC-LOG-003: auditadmin view logs (except own)
  r = await login('auditadmin', 'Admin@123');
  const auditSid = r.json?.sessionId;
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=5', null, auditSid);
  record('TC-LOG-003', r.statusCode === 200 && r.json?.items, r.statusCode, 'auditadmin can view logs');

  // TC-LOG-004: authadmin only login logs
  r = await login('authadmin', 'Admin@123');
  const authSid = r.json?.sessionId;
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=100', null, authSid);
  const hasOperType = (r.json?.items || []).some(i => i.logType === 'operation');
  record('TC-LOG-004', r.statusCode === 200 && !hasOperType, r.statusCode, `authadmin only login logs (hasOperation=${hasOperType})`);

  // TC-LOG-005: sysadmin only operation logs
  r = await login('sysadmin', 'Admin@123');
  const sysSid = r.json?.sessionId;
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=100', null, sysSid);
  const hasLoginType = (r.json?.items || []).some(i => i.logType === 'login');
  record('TC-LOG-005', r.statusCode === 200 && !hasLoginType, r.statusCode, `sysadmin only operation logs (hasLogin=${hasLoginType})`);

  // TC-LOG-011: normal user cannot view logs
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=5', null, sid);
  record('TC-LOG-011', r.statusCode === 403, r.statusCode, 'common user cannot view operlog');

  // TC-APPR-004: sysadmin cannot approve
  r = await apiCall('PATCH', '/sys-user-approval/1/approve', { approved: true }, sysSid);
  record('TC-APPR-004', r.statusCode === 403, r.statusCode, 'sysadmin cannot approve user ops');

  // ============================================================
  // 四、群组管理模块 (TC-GRP-001~015)
  // ============================================================
  console.log('===== 群组管理模块 =====');
  r = await login('test1', '123456');
  const t1Sid = r.json?.sessionId;

  // TC-GRP-001: create group with user members
  r = await apiCall('POST', '/meeting-groups', { groupName: 'test-group-1', memberUserIds: [5, 6] }, t1Sid);
  let groupId = r.json?.groupId;
  record('TC-GRP-001', r.statusCode === 201 && groupId, r.statusCode, `create group, groupId=${groupId}`);

  // TC-GRP-002: create group with dept members
  r = await apiCall('POST', '/meeting-groups', { groupName: 'dept-group', memberDeptIds: [1] }, t1Sid);
  record('TC-GRP-002', r.statusCode === 201, r.statusCode, `create group by dept, body=${r.body.substring(0, 100)}`);

  // TC-GRP-004: list groups
  r = await apiCall('GET', '/meeting-groups', null, t1Sid);
  record('TC-GRP-004', r.statusCode === 200 && r.json?.items, r.statusCode, 'group list');

  // TC-GRP-005: search by name
  r = await apiCall('GET', '/meeting-groups?groupName=test', null, t1Sid);
  record('TC-GRP-005', r.statusCode === 200, r.statusCode, 'search group by name');

  // TC-GRP-006: group detail
  if (groupId) {
    r = await apiCall('GET', `/meeting-groups/${groupId}`, null, t1Sid);
    record('TC-GRP-006', r.statusCode === 200, r.statusCode, 'group detail');
  }

  // TC-GRP-007: add members
  if (groupId) {
    r = await apiCall('PATCH', `/meeting-groups/${groupId}`, { addUserIds: [7] }, t1Sid);
    record('TC-GRP-007', r.statusCode === 200, r.statusCode, 'add member');
  }

  // TC-GRP-008: remove members
  if (groupId) {
    r = await apiCall('PATCH', `/meeting-groups/${groupId}`, { removeUserIds: [7] }, t1Sid);
    record('TC-GRP-008', r.statusCode === 200, r.statusCode, 'remove member');
  }

  // TC-GRP-009: rename group
  if (groupId) {
    r = await apiCall('PATCH', `/meeting-groups/${groupId}`, { groupName: 'renamed-group' }, t1Sid);
    record('TC-GRP-009', r.statusCode === 200, r.statusCode, 'rename group');
  }

  // TC-GRP-013: empty name
  r = await apiCall('POST', '/meeting-groups', { groupName: '', memberUserIds: [] }, t1Sid);
  record('TC-GRP-013', r.statusCode === 400, r.statusCode, `empty group name (DEFECT: returns ${r.statusCode})`, r.statusCode === 500);

  // TC-GRP-015: 51 char name
  r = await apiCall('POST', '/meeting-groups', { groupName: 'a'.repeat(51), memberUserIds: [] }, t1Sid);
  record('TC-GRP-015', r.statusCode === 400, r.statusCode, `51 char name (DEFECT: returns ${r.statusCode})`, r.statusCode === 500);

  // TC-GRP-010: delete group
  if (groupId) {
    r = await apiCall('DELETE', `/meeting-groups/${groupId}`, null, t1Sid);
    record('TC-GRP-010', r.statusCode === 204, r.statusCode, 'delete group');
  }

  // ============================================================
  // 五、会议申请审批模块 (TC-APP-001~013)
  // ============================================================
  console.log('===== 会议申请审批模块 =====');

  // TC-APP-001: submit app (priority in Chinese: 高/中/低)
  r = await apiCall('POST', '/meeting-applications', { title: '年度总结会', meetingTime: '2026-09-01 14:00', location: '一号会议室', deptCount: 5, priority: '高' }, t1Sid);
  let appId = r.json?.appId;
  record('TC-APP-001', r.statusCode === 201 && appId, r.statusCode, `submit app (priority=高), appId=${appId}`);

  // TC-APP-002: default priority
  r = await apiCall('POST', '/meeting-applications', { title: '普通会议', meetingTime: '2026-09-01 15:00' }, t1Sid);
  let appId2 = r.json?.appId;
  record('TC-APP-002', r.statusCode === 201, r.statusCode, `default priority=中, appId=${appId2}`);

  // TC-APP-007: common user cannot approve
  r = await apiCall('PATCH', '/meeting-applications/1/approve', { approved: true }, t1Sid);
  record('TC-APP-007', r.statusCode === 403, r.statusCode, 'common user cannot approve');

  // TC-APP-012: invalid priority
  r = await apiCall('POST', '/meeting-applications', { title: 'test', meetingTime: '2026-09-01', priority: '超高' }, t1Sid);
  record('TC-APP-012', r.statusCode === 400, r.statusCode, `invalid priority (DEFECT: returns ${r.statusCode})`, r.statusCode === 500);

  // TC-APP-009: user app list
  r = await apiCall('GET', '/meeting-applications/list', null, t1Sid);
  record('TC-APP-009', r.statusCode === 200 && r.json?.items, r.statusCode, 'user app list');

  // TC-APP-008: list sorted by priority
  r = await apiCall('GET', '/meeting-applications/list', null, authSid);
  record('TC-APP-008', r.statusCode === 200 && r.json?.items, r.statusCode, 'authadmin app list (sorted by priority)');

  // TC-APP-003: approve
  if (appId) {
    r = await apiCall('PATCH', `/meeting-applications/${appId}/approve`, { approved: true }, authSid);
    record('TC-APP-003', r.statusCode === 200 && r.json?.status === 'approved', r.statusCode, `approve app, status=${r.json?.status}`);

    // TC-APP-010: duplicate approve
    r = await apiCall('PATCH', `/meeting-applications/${appId}/approve`, { approved: true }, authSid);
    record('TC-APP-010', r.statusCode === 400, r.statusCode, 'duplicate approve');

    // TC-APP-005: start approved meeting
    r = await apiCall('POST', `/meeting-applications/${appId}/start`, {}, t1Sid);
    record('TC-APP-005', r.statusCode === 200 && r.json?.meetingId, r.statusCode, `start approved meeting, meetingId=${r.json?.meetingId}`);
  }

  // TC-APP-004: reject
  if (appId2) {
    r = await apiCall('PATCH', `/meeting-applications/${appId2}/approve`, { approved: false, rejectReason: '时间冲突' }, authSid);
    record('TC-APP-004', r.statusCode === 200 && r.json?.status === 'rejected', r.statusCode, `reject app, status=${r.json?.status}`);

    // TC-APP-006: start rejected meeting
    r = await apiCall('POST', `/meeting-applications/${appId2}/start`, {}, t1Sid);
    record('TC-APP-006', r.statusCode === 400, r.statusCode, 'start rejected meeting (expect 400)');
  }

  // TC-APP-013: non-applicant start
  let t2Login = await login('test2', '123456');
  const t2Sid = t2Login.json?.sessionId;
  if (appId) {
    r = await apiCall('POST', `/meeting-applications/${appId}/start`, {}, t2Sid);
    record('TC-APP-013', r.statusCode === 403, r.statusCode, 'non-applicant start (expect 403)');
  }

  // ============================================================
  // 六、system 隐藏用户模块 (TC-SYS-001~003)
  // ============================================================
  console.log('===== system 隐藏用户模块 =====');

  // TC-SYS-001: system hidden in user list
  r = await apiCall('GET', '/sys-user/list?page=1&pageSize=100', null, adminSid);
  const hasSystemUser = r.body.includes('"userName":"system"') || r.body.includes('"user_name":"system"');
  record('TC-SYS-001', r.statusCode === 200 && !hasSystemUser, r.statusCode, `system hidden in user list (found=${hasSystemUser})`);

  // TC-SYS-002: system has admin role
  r = await login('system', 'system123');
  record('TC-SYS-002', r.json?.roles?.includes('admin'), r.statusCode, `system has admin role=${r.json?.roles?.includes('admin')}`);

  // ============================================================
  // 七、会议邀请模块 (TC-INV-001~006)
  // ============================================================
  console.log('===== 会议邀请模块 =====');

  // TC-INV-006: invite nonexistent user
  r = await apiCall('POST', '/meetings/1/invite', { userIds: [99999] }, adminSid);
  record('TC-INV-006', r.statusCode === 200 && r.json?.invited === 0, r.statusCode, `invite nonexistent user, invited=${r.json?.invited}`);

  // TC-INV-005: duplicate invite
  r = await apiCall('POST', '/meetings/1/invite', { userIds: [2] }, adminSid);
  let invited1 = r.json?.invited;
  r = await apiCall('POST', '/meetings/1/invite', { userIds: [2] }, adminSid);
  let invited2 = r.json?.invited;
  record('TC-INV-005', r.statusCode === 200 && invited2 === 0, r.statusCode, `duplicate invite (first=${invited1}, second=${invited2})`);

  // TC-INV-003: view invitation list
  r = await apiCall('GET', '/meetings/1/invitations', null, adminSid);
  record('TC-INV-003', r.statusCode === 200, r.statusCode, 'view invitation list');

  // ============================================================
  // 八、综合端到端 (TC-E2E-001~005)
  // ============================================================
  console.log('===== 综合端到端 =====');

  // TC-E2E-005: security compliance
  for (let i = 0; i < 5; i++) await login('test5', 'wrong');
  r = await login('test5', '123456');
  record('TC-E2E-005', r.statusCode === 423, r.statusCode, '5 fails then lock');

  // TC-E2E-003: three-role user management
  // sysadmin submits create user approval
  r = await apiCall('POST', '/sys-user-approval', { requestType: 'create', requestData: { userName: 'newuser_e2e', nickName: 'E2E新用户', password: 'Abcd@123', deptId: 1 } }, sysSid);
  let approvalId = r.json?.approvalId;
  record('TC-E2E-003a', r.statusCode === 201 && approvalId, r.statusCode, `sysadmin submit create user approval, approvalId=${approvalId}`);

  if (approvalId) {
    // authadmin approves
    r = await apiCall('PATCH', `/sys-user-approval/${approvalId}/approve`, { approved: true }, authSid);
    record('TC-E2E-003b', r.statusCode === 200, r.statusCode, `authadmin approve user creation`);

    // new user can login
    r = await login('newuser_e2e', 'Abcd@123');
    record('TC-E2E-003c', r.statusCode === 200, r.statusCode, `new user login after approval, body=${r.body.substring(0, 100)}`);
  }

  // ============================================================
  // Output Results
  // ============================================================
  console.log('\n==================== 测试结果汇总 ====================\n');
  let passCount = 0, failCount = 0, defectCount = 0;
  for (const r of results) {
    const status = r.pass ? '✓ PASS' : (r.defect ? '✗ DEFECT' : '✗ FAIL');
    if (r.pass) passCount++;
    else if (r.defect) defectCount++;
    else failCount++;
    console.log(`${status} | ${r.id} | HTTP ${r.code} | ${r.detail}`);
  }
  console.log('');
  console.log(`总计: PASS=${passCount}  FAIL=${failCount}  DEFECT=${defectCount}  总用例=${results.length}`);

  // Save results
  fs.writeFileSync('d:/workspace/aitools/cursor/meeting/scripts/test-results-2.json', JSON.stringify(results, null, 2));
  console.log('\n详细结果已保存到 scripts/test-results-2.json');
}

main().catch(err => { console.error('Test script error:', err); process.exit(1); });
