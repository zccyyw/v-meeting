import { createPool } from "../serve/api/src/db.ts";
import { hashPassword } from "../serve/api/src/auth.ts";

const db = createPool();
const hash = await hashPassword("123456");

for (let i = 1; i <= 10; i++) {
  const username = `test${i}`;
  await db.query(
    `INSERT INTO users (username, password_hash, display_name, role, status)
     VALUES (?, ?, ?, 'user', 'active')
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       display_name = VALUES(display_name),
       role = 'user',
       status = 'active'`,
    [username, hash, `测试用户${i}`],
  );
  console.log("seeded", username);
}

const [rows] = await db.query(
  "SELECT username, display_name, role, status FROM users WHERE username LIKE 'test%' ORDER BY username",
);
console.log(JSON.stringify(rows, null, 2));
await db.end();
