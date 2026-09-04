// Verify TC-PWD-007: no special char should fail
const http = require('http');

function apiCall(method, path, body, sessionId) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (sessionId) headers['x-session-id'] = sessionId;
    const req = http.request({ hostname: '127.0.0.1', port: 8080, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, json: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // Login test4 (password 123456 after reset)
  let r = await apiCall('POST', '/auth/login', { username: 'test4', password: '123456' });
  console.log('Login test4:', r.statusCode, r.json?.sessionId ? 'OK' : r.body);
  const sid = r.json?.sessionId;

  // TC-PWD-001: Change to Abcdef@123 (has special char @)
  r = await apiCall('POST', '/auth/change-password', { currentPassword: '123456', newPassword: 'Abcdef@123' }, sid);
  console.log('TC-PWD-001 change to Abcdef@123:', r.statusCode, r.body);

  // TC-PWD-007: Change to Abcdefg123 (NO special char) - should fail with 400
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcdef@123', newPassword: 'Abcdefg123' }, sid);
  console.log('TC-PWD-007 change to Abcdefg123 (no special):', r.statusCode, r.body);
  console.log('  Expected: 400 password_policy_violation');
  console.log('  Actual:', r.statusCode === 400 ? 'PASS' : 'FAIL/DEFECT');

  // Also check with a password that has NO special char at all
  r = await apiCall('POST', '/auth/change-password', { currentPassword: 'Abcdef@123', newPassword: 'Test1234' }, sid);
  console.log('TC-PWD-007b change to Test1234 (no special):', r.statusCode, r.body);

  // Check sys_config for requireSpecial
  r = await apiCall('GET', '/sys-config/list', null, sid);
  console.log('sys-config list (user):', r.statusCode, r.body.substring(0, 200));
}

main().catch(console.error);
