import mysql from "mysql2/promise";
import type { Db, QueryResult } from "./types.js";

type MysqlBaseOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
};

/**
 * 库名解析集中在此，供建库与连接池共用，避免两处默认值漂移。
 */
export function resolveMysqlDatabase(): string {
  return process.env.MYSQL_DATABASE ?? "meeting";
}

function baseOptions(): MysqlBaseOptions {
  return {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "meeting",
    password: process.env.MYSQL_PASSWORD ?? "meetingpass",
  };
}

/**
 * 连接池把 database 写进握手参数，库不存在时连接阶段就失败（1049
 * ER_BAD_DB_ERROR），启动流程连一条 SQL 都执行不到。而 rpm %post 与
 * configure.mjs 均不建库，全新机器上必现。
 *
 * 因此先用不指定 database 的管理连接确保库存在（幂等）。任何失败都只记
 * 一条告警、不中断启动：库已存在时账号往往只有库级权限（无 CREATE），
 * 此时应继续由连接池暴露真实问题，而不是在这里伪装成权限错误。
 */
async function ensureDatabase(
  base: MysqlBaseOptions,
  database: string,
): Promise<void> {
  let conn: mysql.Connection | undefined;
  try {
    conn = await mysql.createConnection(base);
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, "``")}\` DEFAULT CHARACTER SET utf8mb4`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[db] 未能自动创建 MySQL 数据库 "${database}"：${msg}\n` +
        `[db] 若该库不存在，请手工执行：CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4;`,
    );
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

export async function createMysqlPool(): Promise<Db> {
  const database = resolveMysqlDatabase();
  const base = baseOptions();
  await ensureDatabase(base, database);

  const pool = mysql.createPool({
    ...base,
    database,
    waitForConnections: true,
    connectionLimit: 10,
  });

  return {
    driver: "mysql",
    async query(sql: string, params: unknown[] = []): Promise<[QueryResult, unknown]> {
      const [result, fields] = await pool.query(sql, params);
      return [result as QueryResult, fields];
    },
    async end() {
      await pool.end();
    },
  };
}
