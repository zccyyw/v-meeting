export type DbDriver = "mysql" | "postgres" | "sqlite";

/** mysql2-compatible result header for INSERT/UPDATE/DELETE. */
export type ResultHeader = {
  insertId: number;
  affectedRows: number;
};

export type QueryResult = ResultHeader | Record<string, unknown>[];

export type Db = {
  readonly driver: DbDriver;
  query(sql: string, params?: unknown[]): Promise<[QueryResult, unknown]>;
  end(): Promise<void>;
};

export function resolveDriver(
  raw = process.env.DB_DRIVER ?? process.env.DB_TYPE ?? "sqlite",
): DbDriver {
  const v = raw.trim().toLowerCase();
  if (v === "postgres" || v === "postgresql" || v === "pg") return "postgres";
  if (v === "sqlite" || v === "sqlite3") return "sqlite";
  return "mysql";
}

export function isUniqueViolation(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  // SQLITE_CONSTRAINT_UNIQUE 的 code 为 "23505"? 实际 better-sqlite3 返回
  // err.code === "SQLITE_CONSTRAINT_UNIQUE"。兼容三种驱动。
  return (
    code === "ER_DUP_ENTRY" ||
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

/** Convert `?` placeholders to `$1`, `$2`, … for node-postgres. */
export function qmarksToDollar(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}
