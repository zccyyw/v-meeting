import pg from "pg";
import type { Db, QueryResult, ResultHeader } from "./types.js";
import { qmarksToDollar } from "./types.js";

/**
 * 解析 INSERT 语句的目标表名（支持 "schema"."table" 或裸表名）。
 * 返回未加引号的表名；解析失败返回 null。
 */
function parseInsertTarget(sql: string): string | null {
  const m = /^\s*INSERT\s+INTO\s+(?:"([^"]+)"\s*\.\s*"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i.exec(sql);
  if (!m) return null;
  // 分组 3 = 裸表名；分组 2 = 带 schema 时的表名
  return m[3] ?? m[2] ?? null;
}

/**
 * For Postgres INSERTs without RETURNING, append `RETURNING <pk>`
 * so callers can keep using insertId like mysql2.
 *
 * Unlike the old hard-coded `RETURNING id`, this resolves the target table's
 * actual primary key column(s) from information_schema and appends the first
 * one. sys_* tables use `*_id` PKs (user_id / role_id / menu_id / …) and
 * association tables use composite PKs — none have an `id` column, so the
 * hard-coded `RETURNING id` would fail on every such INSERT.
 */
export async function ensureReturning(
  pool: pg.Pool,
  pkCache: Map<string, string | null>,
  sql: string,
): Promise<string> {
  if (!/^\s*INSERT\s+/i.test(sql)) return sql;
  if (/\bRETURNING\b/i.test(sql)) return sql;

  const table = parseInsertTarget(sql);
  if (!table) return `${sql.replace(/;?\s*$/, "")} RETURNING id`;

  let pk: string | null | undefined = pkCache.get(table);
  if (pk === undefined) {
    try {
      const res = await pool.query(
        `SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_name = $1
          ORDER BY kcu.ordinal_position
          LIMIT 1`,
        [table],
      );
      pk = (res.rows[0] as { column_name?: string } | undefined)?.column_name ?? null;
    } catch {
      pk = null;
    }
    pkCache.set(table, pk);
  }

  // 无主键：退回不追加 RETURNING（insertId 将为 0，调用方不应依赖它）
  if (!pk) return sql;
  return `${sql.replace(/;?\s*$/, "")} RETURNING ${pk}`;
}

export function createPostgresPool(): Db {
  const pool = new pg.Pool({
    host: process.env.PGHOST ?? process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
    user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? "meeting",
    password:
      process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? "meetingpass",
    database:
      process.env.PGDATABASE ?? process.env.POSTGRES_DATABASE ?? "meeting",
    max: 10,
  });

  // 主键列名缓存：避免每个 INSERT 都查询 information_schema
  const pkCache = new Map<string, string | null>();

  return {
    driver: "postgres",
    async query(sql: string, params: unknown[] = []): Promise<[QueryResult, unknown]> {
      let text = qmarksToDollar(sql);
      const isInsert = /^\s*INSERT\s+/i.test(text);
      if (isInsert) text = await ensureReturning(pool, pkCache, text);

      const result = await pool.query(text, params);

      if (isInsert) {
        const row = result.rows[0] as Record<string, unknown> | undefined;
        // 取 RETURNING 返回的主键列值（列名不固定，取第一个返回列）
        const first = row ? Object.values(row)[0] : undefined;
        const header: ResultHeader = {
          insertId: first != null ? Number(first) : 0,
          affectedRows: result.rowCount ?? 0,
        };
        return [header, result];
      }

      if (/^\s*(UPDATE|DELETE)\s+/i.test(text)) {
        const header: ResultHeader = {
          insertId: 0,
          affectedRows: result.rowCount ?? 0,
        };
        return [header, result];
      }

      return [result.rows as Record<string, unknown>[], result];
    },
    async end() {
      await pool.end();
    },
  };
}
