import mysql from "mysql2/promise";
import type { Db, QueryResult } from "./types.js";

export function createMysqlPool(): Db {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "meeting",
    password: process.env.MYSQL_PASSWORD ?? "meetingpass",
    database: process.env.MYSQL_DATABASE ?? "meeting",
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
