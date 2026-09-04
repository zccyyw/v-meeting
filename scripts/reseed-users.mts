import { createPool } from "../serve/api/src/db.ts";
import { hashPassword } from "../serve/api/src/auth.ts";

const db = createPool();

async function main() {
  const [before] = await db.query(
    "SELECT username, role, status FROM users ORDER BY username",
  );
  console.log("before count:", (before as unknown[]).length);
  console.log(JSON.stringify(before, null, 2));

  const adminHash = await hashPassword("admin123");
  await db.query(
    `INSERT INTO users (username, password_hash, display_name, role, status)
     VALUES ('admin', ?, '管理员', 'admin', 'active')
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       display_name = VALUES(display_name),
       role = 'admin',
       status = 'active'`,
    [adminHash],
  );
  console.log("seeded admin");

  const testHash = await hashPassword("123456");
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
      [username, testHash, `测试用户${i}`],
    );
    console.log("seeded", username);
  }

  const [after] = await db.query(
    "SELECT username, role, status FROM users ORDER BY username",
  );
  console.log("after count:", (after as unknown[]).length);
  console.log(JSON.stringify(after, null, 2));
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
