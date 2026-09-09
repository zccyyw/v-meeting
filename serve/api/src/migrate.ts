import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USERS_ADMIN_COLUMNS_MYSQL = [
  {
    name: "role",
    ddl: "role VARCHAR(16) NOT NULL DEFAULT 'user'",
    sqliteDdl: undefined as string | undefined,
  },
  {
    name: "status",
    ddl: "status VARCHAR(16) NOT NULL DEFAULT 'active'",
    sqliteDdl: undefined as string | undefined,
  },
  {
    name: "phone",
    ddl: "phone VARCHAR(32) NULL",
    sqliteDdl: undefined as string | undefined,
  },
  {
    name: "updated_at",
    ddl: "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    sqliteDdl: undefined as string | undefined,
  },
] as const;

const USERS_ADMIN_COLUMNS_PG = [
  {
    name: "role",
    ddl: "role VARCHAR(16) NOT NULL DEFAULT 'user'",
    sqliteDdl: "role TEXT NOT NULL DEFAULT 'user'",
  },
  {
    name: "status",
    ddl: "status VARCHAR(16) NOT NULL DEFAULT 'active'",
    sqliteDdl: "status TEXT NOT NULL DEFAULT 'active'",
  },
  {
    name: "phone",
    ddl: "phone VARCHAR(32) NULL",
    sqliteDdl: "phone TEXT",
  },
  {
    name: "updated_at",
    ddl: "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    sqliteDdl: "updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
  },
] as const;

async function listUserColumns(db: Db): Promise<Set<string>> {
  if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'users'`,
    );
    return new Set(
      (rows as Array<{ name: string }>).map((r) => String(r.name).toLowerCase()),
    );
  }
  if (db.driver === "sqlite") {
    const [rows] = await db.query(`PRAGMA table_info(users)`);
    return new Set(
      (rows as Array<{ name: string }>).map((r) => String(r.name).toLowerCase()),
    );
  }
  const [rows] = await db.query(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
  );
  return new Set(
    (rows as Array<{ name: string }>).map((r) => String(r.name).toLowerCase()),
  );
}

async function hasMeetingJoinPassword(db: Db): Promise<boolean> {
  if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'meetings'
         AND column_name = 'join_password_hash'
       LIMIT 1`,
    );
    return (rows as unknown[]).length > 0;
  }
  if (db.driver === "sqlite") {
    const [rows] = await db.query(`PRAGMA table_info(meetings)`);
    return (rows as Array<{ name: string }>).some(
      (r) => String(r.name).toLowerCase() === "join_password_hash",
    );
  }
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings'
       AND COLUMN_NAME = 'join_password_hash'`,
  );
  return (rows as unknown[]).length > 0;
}

async function migrateUsersAdmin(db: Db): Promise<number> {
  const existing = await listUserColumns(db);
  if (existing.size === 0) return 0;

  const cols =
    db.driver === "postgres" || db.driver === "sqlite"
      ? USERS_ADMIN_COLUMNS_PG
      : USERS_ADMIN_COLUMNS_MYSQL;
  const missing = cols.filter((c) => !existing.has(c.name));
  if (missing.length === 0) return 1;

  if (db.driver === "postgres") {
    for (const col of missing) {
      await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.ddl}`);
    }
    await ensurePostgresUpdatedAtTrigger(db);
    return 1;
  }
  if (db.driver === "sqlite") {
    for (const col of missing) {
      await db.query(`ALTER TABLE users ADD COLUMN ${col.sqliteDdl ?? col.ddl}`);
    }
    await ensureSqliteUpdatedAtTrigger(db);
    return 1;
  }

  await db.query(
    `ALTER TABLE users ${missing.map((c) => `ADD COLUMN ${c.ddl}`).join(", ")}`,
  );
  return 1;
}

async function ensurePostgresUpdatedAtTrigger(db: Db): Promise<void> {
  await db.query(`
    CREATE OR REPLACE FUNCTION meeting_set_updated_at()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql
  `);
  await db.query(`DROP TRIGGER IF EXISTS trg_users_updated_at ON users`);
  await db.query(`
    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE PROCEDURE meeting_set_updated_at()
  `);
}

async function ensureSqliteUpdatedAtTrigger(db: Db): Promise<void> {
  await db.query(`
    CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
      AFTER UPDATE ON users
      FOR EACH ROW
      WHEN (NEW.updated_at = OLD.updated_at OR NEW.updated_at IS OLD.updated_at)
      BEGIN
        UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
      END
  `);
}

async function migrateMeetingJoinPassword(db: Db): Promise<number> {
  if (await hasMeetingJoinPassword(db)) return 1;
  if (db.driver === "postgres") {
    await db.query(
      `ALTER TABLE meetings ADD COLUMN IF NOT EXISTS join_password_hash VARCHAR(100) NULL`,
    );
  } else if (db.driver === "sqlite") {
    await db.query(
      `ALTER TABLE meetings ADD COLUMN join_password_hash TEXT`,
    );
  } else {
    await db.query(
      `ALTER TABLE meetings ADD COLUMN join_password_hash VARCHAR(100) NULL`,
    );
  }
  return 1;
}

async function hasMeetingRecordAllowed(db: Db): Promise<boolean> {
  if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'meetings'
         AND column_name = 'record_allowed'
       LIMIT 1`,
    );
    return (rows as unknown[]).length > 0;
  }
  if (db.driver === "sqlite") {
    const [rows] = await db.query(`PRAGMA table_info(meetings)`);
    return (rows as Array<{ name: string }>).some(
      (r) => String(r.name).toLowerCase() === "record_allowed",
    );
  }
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings'
       AND COLUMN_NAME = 'record_allowed'`,
  );
  return (rows as unknown[]).length > 0;
}

async function migrateMeetingRecordAllowed(db: Db): Promise<number> {
  if (await hasMeetingRecordAllowed(db)) return 1;
  if (db.driver === "postgres") {
    await db.query(
      `ALTER TABLE meetings ADD COLUMN IF NOT EXISTS record_allowed BOOLEAN NOT NULL DEFAULT FALSE`,
    );
  } else if (db.driver === "sqlite") {
    await db.query(
      `ALTER TABLE meetings ADD COLUMN record_allowed INTEGER NOT NULL DEFAULT 0`,
    );
  } else {
    await db.query(
      `ALTER TABLE meetings ADD COLUMN record_allowed TINYINT(1) NOT NULL DEFAULT 0`,
    );
  }
  return 1;
}

/**
 * 判断是否为"对象已存在"类错误——迁移需幂等，此类错误应跳过而非中断启动。
 *
 * 注意：MySQL 重复列的错误码是 ER_DUP_FIELDNAME（1060）而非 ER_DUP_FIELD；
 * 历史上误写为 ER_DUP_FIELD，导致 MySQL 下重复列容错完全失效
 * （表现为服务启动时 "Duplicate column name 'xxx'" 崩溃）。
 */
function isIdempotentError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const errno = (err as { errno?: number })?.errno;
  return (
    code === "ER_DUP_KEYNAME" ||      // MySQL: duplicate index (1061)
    code === "ER_DUP_FIELDNAME" ||    // MySQL: duplicate column (1060)
    code === "ER_DUP_FIELD" ||        // 兼容旧写法/部分驱动
    errno === 1060 ||                 // MySQL: duplicate column（按 errno 兜底）
    errno === 1061 ||                 // MySQL: duplicate index（按 errno 兜底）
    code === "42P07" ||               // PostgreSQL: duplicate table/index
    code === "42701" ||               // PostgreSQL: duplicate column
    code === "42P06" ||               // PostgreSQL: duplicate schema
    code === "SQLITE_ERROR"           // SQLite: generic (e.g. index/column exists)
  );
}

/** Split SQL file into statements; keep dollar-quoted bodies intact. */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  while (i < sql.length) {
    if (sql[i] === "$") {
      const rest = sql.slice(i);
      const m = rest.match(/^\$([A-Za-z0-9_]*)\$/);
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end >= 0) {
          buf += sql.slice(i, end + tag.length);
          i = end + tag.length;
          continue;
        }
      }
    }
    const ch = sql[i]!;
    // 跟踪引号状态，引号内的 ; 不作为分隔符
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      buf += ch;
      i += 1;
      continue;
    }
    // 转义字符（如 \' 或 ""）跳过
    if (ch === "\\" && i + 1 < sql.length) {
      buf += ch + sql[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === ";" && !inSingleQuote && !inDoubleQuote) {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

// ─── 006: users → sys_user 重命名 + RBAC 迁移 ───

async function tableExists(db: Db, tableName: string): Promise<boolean> {
  if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
      [tableName],
    );
    return (rows as unknown[]).length > 0;
  }
  if (db.driver === "sqlite") {
    const [rows] = await db.query(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
      [tableName],
    );
    return (rows as unknown[]).length > 0;
  }
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = database() AND table_name = ? LIMIT 1`,
    [tableName],
  );
  return (rows as unknown[]).length > 0;
}

async function columnExists(db: Db, tableName: string, colName: string): Promise<boolean> {
  if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1
         AND column_name = $2 LIMIT 1`,
      [tableName, colName],
    );
    return (rows as unknown[]).length > 0;
  }
  if (db.driver === "sqlite") {
    const [rows] = await db.query(`PRAGMA table_info(${tableName})`);
    return (rows as Array<{ name: string }>).some(
      (r) => String(r.name).toLowerCase() === colName.toLowerCase(),
    );
  }
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = database() AND table_name = ?
       AND column_name = ? LIMIT 1`,
    [tableName, colName],
  );
  return (rows as unknown[]).length > 0;
}

async function indexExists(db: Db, tableName: string, indexName: string): Promise<boolean> {
  if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2 LIMIT 1`,
      [tableName, indexName],
    );
    return (rows as unknown[]).length > 0;
  }
  if (db.driver === "sqlite") {
    const [rows] = await db.query(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name=? LIMIT 1`,
      [indexName],
    );
    return (rows as unknown[]).length > 0;
  }
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = database() AND table_name = ? AND index_name = ? LIMIT 1`,
    [tableName, indexName],
  );
  return (rows as unknown[]).length > 0;
}

async function migrateRecordingsIndexes(db: Db): Promise<number> {
  const tableOk = await tableExists(db, "recordings");
  if (!tableOk) return 0;

  let count = 0;
  if (!(await indexExists(db, "recordings", "idx_recordings_owner"))) {
    await db.query(`CREATE INDEX idx_recordings_owner ON recordings (owner_user_id)`);
    count += 1;
  }
  if (!(await indexExists(db, "recordings", "idx_recordings_meeting"))) {
    await db.query(`CREATE INDEX idx_recordings_meeting ON recordings (meeting_id)`);
    count += 1;
  }
  return count;
}

/** Returns driver-appropriate INSERT conflict-resolution clause.
 * MySQL doesn't support ON CONFLICT; use ON DUPLICATE KEY UPDATE (no-op).
 * Column is qualified with table name to avoid ambiguity in INSERT ... SELECT.
 */
/** 按驱动返回 INSERT 前缀：SQLite 用 INSERT OR IGNORE 规避冲突。 */
function insertIgnore(db: Db): string {
  return db.driver === "sqlite" ? "INSERT OR IGNORE INTO" : "INSERT INTO";
}

function conflictNoOp(db: Db, tableName: string, pkCol: string): string {
  if (db.driver === "mysql")
    return `ON DUPLICATE KEY UPDATE ${tableName}.${pkCol} = ${tableName}.${pkCol}`;
  // SQLite 的 UPSERT 要求给出**与主键/唯一约束完全匹配**的冲突目标：
  // 不带目标会报 "near DO: syntax error"，目标不匹配会报
  // "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"。
  // 这些关联表是复合主键，按表名映射到正确的目标列。
  // SQLite 不支持对 INSERT ... SELECT 使用 UPSERT（ON CONFLICT 只能跟 VALUES），
  // 因此 SQLite 分支返回空串，改由 insertIgnore() 的 INSERT OR IGNORE 处理。
  if (db.driver === "sqlite") return "";
  return "ON CONFLICT DO NOTHING";
}

async function migrateSysUser(db: Db): Promise<number> {
  const sysUserExists = await tableExists(db, "sys_user");
  const usersExists = await tableExists(db, "users");

  // ── Step 1: 重命名 users → sys_user（如果 users 存在且 sys_user 不存在）──
  if (!sysUserExists && usersExists) {
    if (db.driver === "sqlite") {
      await db.query(`ALTER TABLE users RENAME TO sys_user`);
    } else if (db.driver === "postgres") {
      await db.query(`ALTER TABLE users RENAME TO sys_user`);
    } else {
      await db.query(`RENAME TABLE users TO sys_user`);
    }

    // ── Step 2: 重命名列（对齐若依命名）──
    const renames: Array<[string, string]> = [
      ["id", "user_id"],
      ["username", "user_name"],
      ["display_name", "nick_name"],
      ["password_hash", "password"],
      ["phone", "phonenumber"],
      ["created_at", "create_time"],
      ["updated_at", "update_time"],
    ];

    for (const [oldName, newName] of renames) {
      if (await columnExists(db, "sys_user", oldName)) {
        if (db.driver === "sqlite" || db.driver === "postgres") {
          await db.query(`ALTER TABLE sys_user RENAME COLUMN ${oldName} TO ${newName}`);
        } else {
          // MySQL 8.0+ supports RENAME COLUMN
          await db.query(`ALTER TABLE sys_user RENAME COLUMN ${oldName} TO ${newName}`);
        }
      }
    }

    // ── Step 3: 添加若依字段（如果缺失）──
    const newColumns: Array<{ name: string; sqlite: string; mysql: string; pg: string }> = [
      { name: "dept_id", sqlite: "INTEGER", mysql: "BIGINT NULL", pg: "BIGINT" },
      { name: "user_type", sqlite: "TEXT DEFAULT '00'", mysql: "VARCHAR(2) DEFAULT '00'", pg: "VARCHAR(2) DEFAULT '00'" },
      { name: "email", sqlite: "TEXT DEFAULT ''", mysql: "VARCHAR(50) DEFAULT ''", pg: "VARCHAR(50) DEFAULT ''" },
      { name: "sex", sqlite: "TEXT DEFAULT '0'", mysql: "CHAR(1) DEFAULT '0'", pg: "CHAR(1) DEFAULT '0'" },
      { name: "avatar", sqlite: "TEXT DEFAULT ''", mysql: "VARCHAR(100) DEFAULT ''", pg: "VARCHAR(100) DEFAULT ''" },
      { name: "del_flag", sqlite: "TEXT DEFAULT '0'", mysql: "CHAR(1) DEFAULT '0'", pg: "CHAR(1) DEFAULT '0'" },
      { name: "login_ip", sqlite: "TEXT DEFAULT ''", mysql: "VARCHAR(128) DEFAULT ''", pg: "VARCHAR(128) DEFAULT ''" },
      { name: "login_date", sqlite: "TEXT", mysql: "DATETIME NULL", pg: "TIMESTAMPTZ" },
      { name: "pwd_update_date", sqlite: "TEXT", mysql: "DATETIME NULL", pg: "TIMESTAMPTZ" },
      { name: "create_by", sqlite: "TEXT DEFAULT ''", mysql: "VARCHAR(64) DEFAULT ''", pg: "VARCHAR(64) DEFAULT ''" },
      { name: "update_by", sqlite: "TEXT DEFAULT ''", mysql: "VARCHAR(64) DEFAULT ''", pg: "VARCHAR(64) DEFAULT ''" },
      { name: "remark", sqlite: "TEXT", mysql: "VARCHAR(500)", pg: "VARCHAR(500)" },
    ];

    for (const col of newColumns) {
      if (!(await columnExists(db, "sys_user", col.name))) {
        const ddl =
          db.driver === "sqlite" ? col.sqlite : db.driver === "postgres" ? col.pg : col.mysql;
        if (db.driver === "postgres") {
          await db.query(`ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS ${col.name} ${ddl}`);
        } else {
          await db.query(`ALTER TABLE sys_user ADD COLUMN ${col.name} ${ddl}`);
        }
      }
    }

    // ── Step 4: 转换 status 值（active→0, disabled→1）──
    await db.query(
      `UPDATE sys_user SET status = CASE WHEN status = 'active' THEN '0' ELSE '1' END`,
    );

    // ── Step 5: 迁移 role → sys_user_role ──
    const hasRoleCol = await columnExists(db, "sys_user", "role");
    if (hasRoleCol) {
      // admin 角色用户关联到 role_id=1
      await db.query(
        `${insertIgnore(db)} sys_user_role (user_id, role_id)
         SELECT user_id, 1 FROM sys_user WHERE role = 'admin'
         ${conflictNoOp(db, "sys_user_role", "user_id")}`,
      );
      // 普通用户关联到 role_id=2
      await db.query(
        `${insertIgnore(db)} sys_user_role (user_id, role_id)
         SELECT user_id, 2 FROM sys_user WHERE role = 'user' OR role IS NULL OR role NOT IN ('admin')
         ${conflictNoOp(db, "sys_user_role", "user_id")}`,
      );

      // 删除 role 列（如果数据库支持）
      if (db.driver === "sqlite") {
        // SQLite 3.35.0+ 支持 DROP COLUMN
        try {
          await db.query(`ALTER TABLE sys_user DROP COLUMN role`);
        } catch {
          // 旧版 SQLite 不支持 DROP COLUMN，忽略错误
        }
      } else if (db.driver === "postgres") {
        await db.query(`ALTER TABLE sys_user DROP COLUMN IF EXISTS role`);
      } else {
        await db.query(`ALTER TABLE sys_user DROP COLUMN role`);
      }
    }

    // ── Step 6: 给超级管理员角色分配所有菜单 ──
    await db.query(
      `${insertIgnore(db)} sys_role_menu (role_id, menu_id)
       SELECT 1, menu_id FROM sys_menu
       ${conflictNoOp(db, "sys_role_menu", "role_id")}`,
    );

    // ── Step 7: 更新触发器（指向新表名）──
    if (db.driver === "sqlite") {
      await db.query(`
        CREATE TRIGGER IF NOT EXISTS trg_sys_user_update_time
          AFTER UPDATE ON sys_user
          FOR EACH ROW
          WHEN (NEW.update_time = OLD.update_time OR NEW.update_time IS OLD.update_time)
          BEGIN
            UPDATE sys_user SET update_time = datetime('now') WHERE user_id = NEW.user_id;
          END
      `);
      // 删除旧触发器
      try {
        await db.query(`DROP TRIGGER IF EXISTS trg_users_updated_at`);
      } catch { /* ignore */ }
    }

    return 1;
  }

  // 如果 sys_user 已存在，确保 admin 角色有所有菜单
  if (sysUserExists) {
    await db.query(
      `${insertIgnore(db)} sys_role_menu (role_id, menu_id)
       SELECT 1, menu_id FROM sys_menu
       WHERE menu_id NOT IN (SELECT menu_id FROM sys_role_menu WHERE role_id = 1)
       ${conflictNoOp(db, "sys_role_menu", "role_id")}`,
    );
  }

  return 0;
}

/**
 * 安全添加 sys_oper_log 扩展列（oper_object, classification）。
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，通过 PRAGMA table_info 检查列是否存在。
 * MySQL 的 008 SQL 已用 ALTER ... IF NOT EXISTS 处理，此函数对 MySQL 是幂等安全检查。
 * PostgreSQL 的 008 SQL 已用 DO 块处理，此函数也是安全的幂等检查。
 */
async function migrateOperLogExtensions(db: Db): Promise<number> {
  let count = 0;
  const columns = [
    { name: "oper_object", ddl: db.driver === "sqlite" ? "TEXT" : db.driver === "postgres" ? "VARCHAR(200) DEFAULT ''" : "VARCHAR(200) DEFAULT ''" },
    { name: "classification", ddl: db.driver === "sqlite" ? "TEXT DEFAULT '公开'" : db.driver === "postgres" ? "VARCHAR(20) DEFAULT '公开'" : "VARCHAR(20) DEFAULT '公开'" },
  ];

  // 检查列是否已存在
  let existingCols: Set<string>;
  if (db.driver === "sqlite") {
    const [rows] = await db.query(`PRAGMA table_info(sys_oper_log)`);
    existingCols = new Set((rows as { name: string }[]).map((r) => r.name));
  } else if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sys_oper_log' AND table_schema = current_schema()`,
    );
    existingCols = new Set((rows as { column_name: string }[]).map((r) => r.column_name));
  } else {
    const [rows] = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sys_oper_log' AND table_schema = database()`,
    );
    existingCols = new Set((rows as { column_name: string }[]).map((r) => r.column_name));
  }

  for (const col of columns) {
    if (!existingCols.has(col.name)) {
      try {
        await db.query(`ALTER TABLE sys_oper_log ADD COLUMN ${col.name} ${col.ddl}`);
        count += 1;
      } catch {
        // 列可能已被其他进程添加，忽略
      }
    }
  }
  return count;
}

export async function migrate(db?: Db) {
  if (!db) db = await createPool();
  const sqlDir = path.join(__dirname, "sql", db.driver);
  if (!fs.existsSync(sqlDir)) {
    throw new Error(`sql directory missing for driver=${db.driver}: ${sqlDir}`);
  }
  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let count = 0;
  for (const file of files) {
    if (file === "002_users_admin.sql") {
      count += await migrateUsersAdmin(db);
      continue;
    }
    if (file === "003_meeting_join_password.sql") {
      count += await migrateMeetingJoinPassword(db);
      continue;
    }
    if (file === "004_recordings.sql") {
      const sql = fs.readFileSync(path.join(sqlDir, file), "utf8");
      for (const statement of splitSqlStatements(sql)) {
        try {
          await db.query(statement);
          count += 1;
        } catch (err: unknown) {
          if (isIdempotentError(err)) continue;
          throw err;
        }
      }
      count += await migrateRecordingsIndexes(db);
      continue;
    }
    if (file === "005_meeting_record_permission.sql") {
      count += await migrateMeetingRecordAllowed(db);
      continue;
    }
    if (file === "008_sys_security.sql") {
      const sql = fs.readFileSync(path.join(sqlDir, file), "utf8");
      for (const statement of splitSqlStatements(sql)) {
        try {
          await db.query(statement);
          count += 1;
        } catch (err: unknown) {
          if (isIdempotentError(err)) continue;
          throw err;
        }
      }
      // 安全添加 sys_oper_log 扩展列（兼容 SQLite 不支持 ADD COLUMN IF NOT EXISTS）
      count += await migrateOperLogExtensions(db);
      continue;
    }
    const sql = fs.readFileSync(path.join(sqlDir, file), "utf8");
    for (const statement of splitSqlStatements(sql)) {
      try {
        await db.query(statement);
        count += 1;
      } catch (err: unknown) {
        // MySQL 不支持 CREATE INDEX / ADD COLUMN IF NOT EXISTS，
        // 忽略重复索引、重复列等"已存在"错误以保证迁移幂等。
        if (isIdempotentError(err)) {
          // 幂等：已存在则跳过
          continue;
        }
        throw err;
      }
    }
    // 006: SQL 执行后运行 users→sys_user 迁移
    if (file === "006_sys_manager.sql") {
      count += await migrateSysUser(db);
    }
  }
  // 仅在 users 表仍存在时维护其触发器。
  // migrateSysUser 已把 users 重命名为 sys_user（并创建 trg_sys_user_update_time），
  // 此时 users 已不存在，继续创建 trg_users_updated_at 会导致
  // SQLite "no such table: users" / PostgreSQL "relation does not exist" 而崩溃。
  // sys_* 路由均显式写入 update_time，不依赖此触发器。
  if (db.driver === "postgres") {
    if (await tableExists(db, "users")) {
      await ensurePostgresUpdatedAtTrigger(db);
    }
  }
  if (db.driver === "sqlite") {
    if (await tableExists(db, "users")) {
      await ensureSqliteUpdatedAtTrigger(db);
    }
  }
  return count;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  migrate()
    .then(async (n) => {
      console.log(`migrated ${n} statements (driver=${resolveDriverLabel()})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

function resolveDriverLabel(): string {
  return process.env.DB_DRIVER ?? process.env.DB_TYPE ?? "sqlite";
}
