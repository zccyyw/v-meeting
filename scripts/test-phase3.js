// Phase 3: Quick-start, config, online limit tests
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
  // Login as test1
  let r = await login('test1', '123456');
  const t1Sid = r.json?.sessionId;
  
  // Login as admin
  r = await login('admin', 'admin123');
  const adminSid = r.json?.sessionId;
  
  // Login as authadmin
  r = await login('authadmin', 'Admin@123');
  const authSid = r.json?.sessionId;

  // ============================================================
  // 一键群组开会模块 (TC-QS-001~006)
  // ============================================================
  console.log('===== 一键群组开会模块 =====');

  // Create a group with members for quick-start
  r = await apiCall('POST', '/meeting-groups', { groupName: 'quick-start-group', memberUserIds: [6, 7, 8] }, t1Sid);
  let groupId = r.json?.groupId;
  console.log('Created group for quick-start:', groupId);

  // TC-QS-001: quick start with title
  if (groupId) {
    r = await apiCall('POST', `/meeting-groups/${groupId}/quick-start`, { title: '紧急会议' }, t1Sid);
    record('TC-QS-001', r.statusCode === 200 && r.json?.meetingId && r.json?.invitedCount >= 0, r.statusCode, `quick start with title, meetingId=${r.json?.meetingId}, invited=${r.json?.invitedCount}`);
  }

  // TC-QS-002: quick start without title (use group name)
  if (groupId) {
    r = await apiCall('POST', `/meeting-groups/${groupId}/quick-start`, {}, t1Sid);
    record('TC-QS-002', r.statusCode === 200 && r.json?.title === 'quick-start-group', r.statusCode, `default title from group name, title=${r.json?.title}`);
  }

  // TC-QS-003: quick start with waiting room
  if (groupId) {
    r = await apiCall('POST', `/meeting-groups/${groupId}/quick-start`, { waitingRoomEnabled: true }, t1Sid);
    record('TC-QS-003', r.statusCode === 200, r.statusCode, 'quick start with waiting room');
  }

  // TC-QS-004: empty group quick start
  r = await apiCall('POST', '/meeting-groups', { groupName: 'empty-group', memberUserIds: [] }, t1Sid);
  let emptyGroupId = r.json?.groupId;
  if (emptyGroupId) {
    r = await apiCall('POST', `/meeting-groups/${emptyGroupId}/quick-start`, {}, t1Sid);
    record('TC-QS-004', r.statusCode === 200 && r.json?.invitedCount === 0, r.statusCode, `empty group quick start, invited=${r.json?.invitedCount}`);
  }

  // TC-QS-005: non-owner quick start
  r = await login('test2', '123456');
  const t2Sid = r.json?.sessionId;
  if (groupId) {
    r = await apiCall('POST', `/meeting-groups/${groupId}/quick-start`, {}, t2Sid);
    record('TC-QS-005', r.statusCode === 403, r.statusCode, 'non-owner quick start (expect 403)');
  }

  // ============================================================
  // 系统配置模块 (TC-CFG-001~005) - via admin API
  // ============================================================
  console.log('===== 系统配置模块 =====');

  // TC-CFG-003: non-existent config returns default (internal, test via public endpoint)
  r = await apiCall('GET', '/sys-config/public', null, null);
  record('TC-CFG-003', r.statusCode === 200 && r.json?.idleTimeout, r.statusCode, `public config, idleTimeout=${r.json?.idleTimeout}`);

  // ============================================================
  // 在线人数限制模块 (TC-LMT-001~004) - via admin API
  // ============================================================
  console.log('===== 在线人数限制模块 =====');

  // TC-LMT-004: view/modify online maxUsers config
  // Check if admin can view config
  r = await apiCall('GET', '/sys-config/list', null, adminSid);
  record('TC-LMT-004a', r.statusCode === 200, r.statusCode, 'admin view config list');

  // Try to update sys.online.maxUsers
  r = await apiCall('PUT', '/sys-config', { key: 'sys.online.maxUsers', value: '50' }, adminSid);
  record('TC-LMT-004b', r.statusCode === 200 || r.statusCode === 204, r.statusCode, `update maxUsers=50, body=${r.body.substring(0, 100)}`);

  // ============================================================
  // 会议邀请在线状态 (TC-INV-004)
  // ============================================================
  console.log('===== 会议邀请在线状态 =====');

  // TC-INV-004: admin view online meetings
  r = await apiCall('GET', '/admin/meetings/online', null, adminSid);
  record('TC-INV-004', r.statusCode === 200 && r.json?.items !== undefined, r.statusCode, `admin online meetings, items=${r.json?.items?.length}`);

  // ============================================================
  // 审计日志 - CSV export (TC-LOG-007)
  // ============================================================
  console.log('===== 审计日志扩展 =====');

  // TC-LOG-007: export CSV
  r = await apiCall('GET', '/sys-operlog/export', null, adminSid);
  const isCsv = r.body.includes('日志ID') || r.body.includes('operId') || r.body.includes(',');
  record('TC-LOG-007', r.statusCode === 200 && isCsv, r.statusCode, `CSV export, bodyLen=${r.body.length}`);

  // TC-LOG-006: filtered query
  r = await apiCall('GET', '/sys-operlog/list?title=' + encodeURIComponent('登录') + '&logType=login&status=1&page=1&pageSize=5', null, adminSid);
  record('TC-LOG-006', r.statusCode === 200, r.statusCode, 'filtered log query');

  // TC-LOG-009: log has audit fields
  r = await apiCall('GET', '/sys-operlog/list?page=1&pageSize=1', null, adminSid);
  let hasAuditFields = false;
  if (r.json?.items?.[0]) {
    const item = r.json.items[0];
    hasAuditFields = item.operTime && item.operIp && item.logType && item.operUserName !== undefined;
  }
  record('TC-LOG-009', r.statusCode === 200 && hasAuditFields, r.statusCode, 'log has audit fields');

  // ============================================================
  // 用户操作审批模块扩展 (TC-APPR-001~011)
  // ============================================================
  console.log('===== 用户操作审批模块扩展 =====');

  // TC-APPR-009: password policy in approval
  r = await apiCall('POST', '/sys-user-approval', { requestType: 'create', requestData: { userName: 'badpwd', nickName: 'Bad', password: 'abc', deptId: 1 } }, t2Sid);
  // Note: test2 is common user, need sysadmin
  r = await login('sysadmin', 'Admin@123');
  const sysSid = r.json?.sessionId;
  r = await apiCall('POST', '/sys-user-approval', { requestType: 'create', requestData: { userName: 'badpwd', nickName: 'Bad', password: 'abc', deptId: 1 } }, sysSid);
  record('TC-APPR-009', r.statusCode === 400, r.statusCode, `weak password in approval (DEFECT: returns ${r.statusCode})`, r.statusCode === 500);

  // TC-APPR-001: submit create user approval
  r = await apiCall('POST', '/sys-user-approval', { requestType: 'create', requestData: { userName: 'newuser2', nickName: '新用户2', password: 'Abcd@123', deptId: 1 } }, sysSid);
  let approvalId = r.json?.approvalId;
  record('TC-APPR-001', r.statusCode === 201 && approvalId, r.statusCode, `submit create user approval, approvalId=${approvalId}`);

  // TC-APPR-010: list with pagination
  r = await apiCall('GET', '/sys-user-approval/list?page=1&pageSize=10', null, authSid);
  record('TC-APPR-010', r.statusCode === 200 && r.json?.items, r.statusCode, 'approval list pagination');

  // TC-APPR-011: sysadmin sees only own
  r = await apiCall('GET', '/sys-user-approval/list', null, sysSid);
  record('TC-APPR-011', r.statusCode === 200, r.statusCode, 'sysadmin approval list (own only)');

  // TC-APPR-002: authadmin approve
  if (approvalId) {
    r = await apiCall('PATCH', `/sys-user-approval/${approvalId}/approve`, { approved: true }, authSid);
    record('TC-APPR-002', r.statusCode === 200, r.statusCode, `authadmin approve user creation`);

    // Verify new user can login
    r = await login('newuser2', 'Abcd@123');
    record('TC-APPR-002b', r.statusCode === 200, r.statusCode, `new user login after approval, body=${r.body.substring(0, 150)}`);
  }

  // TC-APPR-003: reject
  r = await apiCall('POST', '/sys-user-approval', { requestType: 'create', requestData: { userName: 'rejectme', nickName: 'Reject', password: 'Abcd@123', deptId: 1 } }, sysSid);
  let rejectId = r.json?.approvalId;
  if (rejectId) {
    r = await apiCall('PATCH', `/sys-user-approval/${rejectId}/approve`, { approved: false, rejectReason: '信息不完整' }, authSid);
    record('TC-APPR-003', r.statusCode === 200 && r.json?.status === 'rejected', r.statusCode, `reject user creation, status=${r.json?.status}`);
  }

  // TC-APPR-005: duplicate approve
  if (approvalId) {
    r = await apiCall('PATCH', `/sys-user-approval/${approvalId}/approve`, { approved: true }, authSid);
    record('TC-APPR-005', r.statusCode === 400, r.statusCode, 'duplicate approve (expect 400)');
  }

  // ============================================================
  // Output
  // ============================================================
  console.log('\n==================== Phase 3 测试结果 ====================\n');
  let passCount = 0, failCount = 0, defectCount = 0;
  for (const r of results) {
    const status = r.pass ? '✓ PASS' : (r.defect ? '✗ DEFECT' : '✗ FAIL');
    if (r.pass) passCount++;
    else if (r.defect) defectCount++;
    else failCount++;
    console.log(`${status} | ${r.id} | HTTP ${r.code} | ${r.detail}`);
  }
  console.log('');
  console.log(`Phase 3 总计: PASS=${passCount}  FAIL=${failCount}  DEFECT=${defectCount}  总用例=${results.length}`);

  fs.writeFileSync('d:/workspace/aitools/cursor/meeting/scripts/test-results-3.json', JSON.stringify(results, null, 2));
}

main().catch(err => { console.error('Test script error:', err); process.exit(1); });
