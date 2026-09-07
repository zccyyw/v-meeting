import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Db } from "./db.js";
import { hashPassword } from "./auth.js";
import { hasSysUser } from "./sql-utils.js";

/** 默认测试用户列表（密码 123456，普通角色 role_id=2） */
const TEST_USERS = [
  { username: "test1", nickName: "测试用户1" },
  { username: "test2", nickName: "测试用户2" },
  { username: "test3", nickName: "测试用户3" },
  { username: "test4", nickName: "测试用户4" },
  { username: "test5", nickName: "测试用户5" },
];

/**
 * 三员 + 普通用户默认账号（密码 Admin@123，首次登录提示修改密码）。
 * role_id 对应 sys_role 表中的角色：
 *   3 = sys_admin（系统管理员）
 *   4 = auth_admin（授权管理员）
 *   5 = audit_admin（审计管理员）
 *   2 = common（普通用户，仅有会议功能）
 */
const ROLE_USERS = [
  { username: "sysadmin", nickName: "系统管理员", roleId: 3 },
  { username: "authadmin", nickName: "授权管理员", roleId: 4 },
  { username: "auditadmin", nickName: "审计管理员", roleId: 5 },
  { username: "meeting", nickName: "普通用户", roleId: 2 },
];

/** 返回驱动合适的 sys_user INSERT 冲突处理子句 */
function sysUserUpsert(db: Db): string {
  if (db.driver === "mysql") {
    return `ON DUPLICATE KEY UPDATE
           password = VALUES(password),
           nick_name = VALUES(nick_name),
           status = '0',
           del_flag = '0'`;
  }
  return `ON CONFLICT(user_name) DO UPDATE SET
           password = EXCLUDED.password,
           nick_name = EXCLUDED.nick_name,
           status = '0',
           del_flag = '0'`;
}

/** 返回驱动合适的 sys_user_role INSERT 冲突处理子句 */
function roleConflictNoOp(db: Db): string {
  if (db.driver === "mysql") {
    return `ON DUPLICATE KEY UPDATE sys_user_role.user_id = sys_user_role.user_id`;
  }
  return "ON CONFLICT DO NOTHING";
}

/** 插入单个用户到 sys_user 表（幂等） */
async function seedSysUser(
  db: Db,
  username: string,
  passwordHash: string,
  nickName: string,
): Promise<void> {
  await db.query(
    `INSERT INTO sys_user (user_name, password, nick_name, status, del_flag, create_by)
     VALUES (?, ?, ?, '0', '0', 'admin')
     ${sysUserUpsert(db)}`,
    [username, passwordHash, nickName],
  );
}

/** 分配角色到 sys_user_role 表（幂等） */
async function seedUserRole(db: Db, username: string, roleId: number): Promise<void> {
  await db.query(
    `INSERT INTO sys_user_role (user_id, role_id)
     SELECT user_id, ${roleId} FROM sys_user WHERE user_name = ?
     ${roleConflictNoOp(db)}`,
    [username],
  );
}

/** 插入单个用户到旧 users 表（幂等） */
async function seedLegacyUser(
  db: Db,
  username: string,
  passwordHash: string,
  displayName: string,
  role: string,
): Promise<void> {
  if (db.driver === "postgres" || db.driver === "sqlite") {
    await db.query(
      `INSERT INTO users (username, password_hash, display_name, role, status)
       VALUES (?, ?, ?, ?, 'active')
       ON CONFLICT(username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         status = 'active'`,
      [username, passwordHash, displayName, role],
    );
  } else {
    await db.query(
      `INSERT INTO users (username, password_hash, display_name, role, status)
       VALUES (?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         display_name = VALUES(display_name),
         role = VALUES(role),
         status = 'active'`,
      [username, passwordHash, displayName, role],
    );
  }
}

export async function seedAdmin(db?: Db) {
  if (!db) db = await createPool();
  const adminHash = await hashPassword("admin123");
  const testHash = await hashPassword("123456");
  const useSysUser = await hasSysUser(db);
  const seeded: string[] = [];

  // ── 防重置守卫：目标表已有用户时跳过播种 ──
  // 历史问题：每次启动无条件执行 seed，把管理员改过的密码/停用的测试账号全部重置。
  // 现在仅当表为空（首次部署）时播种；显式设 SEED_FORCE=1 可强制重播。
  const seedTable = useSysUser ? "sys_user" : "users";
  const [cntRows] = await db.query(`SELECT COUNT(*) AS cnt FROM ${seedTable}`);
  const existingCount = Number((cntRows as { cnt?: number | string }[])[0]?.cnt ?? 0);
  if (existingCount > 0 && process.env.SEED_FORCE !== "1") {
    console.log(
      `[seed] ${seedTable} 已有 ${existingCount} 个用户，跳过默认账号播种（SEED_FORCE=1 可强制）`,
    );
    return { seeded: [], skipped: true };
  }

  if (useSysUser) {
    // ── 新表 sys_user（迁移后）──

    // admin 用户（超级管理员 role_id=1）
    await seedSysUser(db, "admin", adminHash, "管理员");
    await seedUserRole(db, "admin", 1);
    seeded.push("admin");

    // system 隐藏用户（超级管理员 role_id=1，密码 system123）
    // 用于系统级操作，对非 system 用户不可见
    const systemHash = await hashPassword("system123");
    await seedSysUser(db, "system", systemHash, "系统用户");
    await seedUserRole(db, "system", 1);
    seeded.push("system");

    // 三员 + 普通用户默认账号（密码 Admin@123，符合密码策略）
    // 首次登录时提示修改密码（isDefaultPassword 检测到默认密码）
    const roleHash = await hashPassword("Admin@123");
    for (const u of ROLE_USERS) {
      await seedSysUser(db, u.username, roleHash, u.nickName);
      await seedUserRole(db, u.username, u.roleId);
      seeded.push(u.username);
    }

    // 确保 Admin@123 在默认密码列表中（触发首次登录修改密码提示）
    try {
      await db.query(
        `UPDATE sys_config SET config_value = '123456,admin123,Admin@123'
         WHERE config_key = 'sys.password.defaultPasswords' AND config_value NOT LIKE '%Admin@123%'`,
      );
    } catch { /* ignore */ }

    // test1-test5 普通用户（role_id=2）
    for (const u of TEST_USERS) {
      await seedSysUser(db, u.username, testHash, u.nickName);
      await seedUserRole(db, u.username, 2);
      seeded.push(u.username);
    }
  } else {
    // ── 旧表 users（向后兼容）──

    // admin 用户
    await seedLegacyUser(db, "admin", adminHash, "管理员", "admin");
    seeded.push("admin");

    // test1-test5 普通用户
    for (const u of TEST_USERS) {
      await seedLegacyUser(db, u.username, testHash, u.nickName, "user");
      seeded.push(u.username);
    }
  }

  return { seeded };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  seedAdmin()
    .then((r) => {
      console.log(`seeded ${r.seeded.length} users: ${r.seeded.join(", ")}`);
      console.log(`  admin       / admin123   (超级管理员)`);
      console.log(`  system      / system123  (系统隐藏用户)`);
      console.log(`  sysadmin    / Admin@123  (系统管理员)`);
      console.log(`  authadmin   / Admin@123  (授权管理员)`);
      console.log(`  auditadmin  / Admin@123  (审计管理员)`);
      console.log(`  meeting     / Admin@123  (普通用户)`);
      console.log(`  test1-5     / 123456     (测试用户)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
