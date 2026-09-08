#!/usr/bin/env node
/**
 * 导出「最新完整数据库表结构」到 serve/sql/schema-<driver>.sql
 *
 * 原理：在临时库上执行 serve/api/src/sql/<driver>/ 下的全部迁移（与应用启动
 * 时执行的迁移完全一致），再从数据库导出最终 DDL —— 保证结构与代码一致。
 *
 * 用法：
 *   node scripts/dump-schema.mjs sqlite              # 从实际迁移导出（权威）
 *   node scripts/dump-schema.mjs mysql|postgres      # 需先配置好对应连接
 *
 * 环境变量（mysql/postgres）：沿用 DB_DRIVER 对应的连接变量
 *   MYSQL_HOST/PORT/USER/PASSWORD/DATABASE
 *   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
 */
import { writeFileSync } from "node:fs";
import { createPool } from "../serve/db/dist/index.js";
import { migrate } from "../serve/api/dist/migrate.js";

const driver = process.argv[2] || "sqlite";
const outFile = `serve/sql/schema-${driver}.sql`;

const header = (extra = []) => [
  "-- ============================================================",
  `-- Meeting 数据库最新完整表结构 — ${driver.toUpperCase()}`,
  "-- 生成方式：执行 serve/api/src/sql/" + driver + "/ 下全部迁移后从数据库导出（权威）",
  "-- 用途：全新环境初始化 / 结构查阅；生产升级请使用迁移（服务启动时自动执行）",
  ...extra,
  "-- ============================================================",
  "",
];

async function dumpSqlite() {
  process.env.DB_DRIVER = "sqlite";
  process.env.SQLITE_PATH = process.env.SQLITE_PATH || ".tmp-schema.sqlite";
  const db = await createPool();
  await migrate(db);
  await migrate(db); // 幂等校验
  const [rows] = await db.query(
    "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name",
  );
  const tables = rows.filter((r) => r.type === "table");
  const indexes = rows.filter((r) => r.type === "index");
  const triggers = rows.filter((r) => r.type === "trigger");
  const out = [
    ...header([
      `-- 表：${tables.length}；索引：${indexes.length}；触发器：${triggers.length}`,
    ]),
    "-- ---------- 表 ----------",
  ];
  for (const t of tables) out.push(t.sql.trim() + ";", "");
  if (indexes.length) {
    out.push("-- ---------- 索引 ----------");
    for (const i of indexes) out.push(i.sql.trim() + ";", "");
  }
  if (triggers.length) {
    out.push("-- ---------- 触发器 ----------");
    for (const t of triggers) out.push(t.sql.trim() + ";", "");
  }
  await db.end();
  return out.join("\n");
}

async function dumpMySql() {
  process.env.DB_DRIVER = "mysql";
  const db = await createPool();
  await migrate(db);
  await migrate(db);
  const [tables] = await db.query(
    "SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
  );
  const out = [...header([`-- 表：${tables.length}`]), "-- ---------- 表 ----------"];
  for (const { t } of tables) {
    const [r] = await db.query(`SHOW CREATE TABLE \`${t}\``);
    out.push(r[0]["Create Table"] + ";", "");
  }
  await db.end();
  return out.join("\n");
}

async function dumpPostgres() {
  process.env.DB_DRIVER = "postgres";
  const db = await createPool();
  await migrate(db);
  await migrate(db);
  // 仅导出业务表（排除扩展与系统对象）
  const [tables] = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`,
  );
  const out = [...header([`-- 表：${tables.length}`]), "-- ---------- 表 ----------"];
  for (const { tablename } of tables) {
    const [r] = await db.query(
      `SELECT 'CREATE TABLE ' || quote_ident($1) || ' (' || string_agg(col, ', ' ORDER BY ord) || ');' AS ddl
       FROM (
         SELECT a.attnum AS ord,
                quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod) ||
                COALESCE(' DEFAULT ' + pg_get_expr(d.adbin, d.adrelid), '') AS col
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = quote_ident($1)::regclass AND a.attnum > 0 AND NOT a.attisdropped
       ) s`,
      [tablename],
    );
    out.push(r[0]?.ddl ?? `-- (skip ${tablename})`, "");
  }
  await db.end();
  return out.join("\n");
}

const dumpers = { sqlite: dumpSqlite, mysql: dumpMySql, postgres: dumpPostgres };
if (!dumpers[driver]) {
  console.error(`unsupported driver: ${driver}`);
  process.exit(1);
}

const sql = await dumpers[driver]();
writeFileSync(outFile, sql, "utf8");
console.log(`written -> ${outFile}`);
