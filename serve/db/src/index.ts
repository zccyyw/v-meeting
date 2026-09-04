import { resolveDriver, type Db, type DbDriver } from "./types.js";

export type {
  Db,
  DbDriver,
  QueryResult,
  ResultHeader,
} from "./types.js";
export {
  isUniqueViolation,
  resolveDriver,
  qmarksToDollar,
} from "./types.js";

export async function createPool(driver: DbDriver = resolveDriver()): Promise<Db> {
  if (driver === "postgres") {
    const { createPostgresPool } = await import("./postgres.js");
    return createPostgresPool();
  }
  if (driver === "sqlite") {
    const { createSqliteDb } = await import("./sqlite.js");
    return createSqliteDb();
  }
  const { createMysqlPool } = await import("./mysql.js");
  return createMysqlPool();
}
