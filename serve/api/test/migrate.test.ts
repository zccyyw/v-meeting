import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, resolveDriver, type Db } from "../src/db.js";
import { migrate } from "../src/migrate.js";

describe("migrate", () => {
  let db!: Db;
  const driver = resolveDriver();

  beforeAll(async () => {
    db = await createPool();
    if (db.driver === "postgres") {
      await db.query("DROP TABLE IF EXISTS meeting_join_tokens CASCADE");
      await db.query("DROP TABLE IF EXISTS meetings CASCADE");
      await db.query("DROP TABLE IF EXISTS users CASCADE");
      await db.query("DROP FUNCTION IF EXISTS meeting_set_updated_at() CASCADE");
    } else {
      await db.query("SET FOREIGN_KEY_CHECKS = 0");
      await db.query("DROP TABLE IF EXISTS meeting_join_tokens");
      await db.query("DROP TABLE IF EXISTS meetings");
      await db.query("DROP TABLE IF EXISTS users");
      await db.query("SET FOREIGN_KEY_CHECKS = 1");
    }
  });

  afterAll(async () => {
    await db.end();
  });

  it("applies schema statements idempotently when DB is up", async () => {
    const first = await migrate(db);
    expect(first).toBeGreaterThan(0);

    const second = await migrate(db);
    expect(second).toBeGreaterThan(0);

    if (db.driver === "postgres") {
      const [cols] = await db.query(
        `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'users'`,
      );
      const names = (cols as Array<{ name: string }>).map((c) =>
        String(c.name).toLowerCase(),
      );
      expect(names).toEqual(
        expect.arrayContaining(["role", "status", "phone", "updated_at"]),
      );
    } else {
      const [rows] = await db.query("SHOW TABLES");
      const tables = (rows as Array<Record<string, string>>).map(
        (r) => Object.values(r)[0],
      );
      expect(tables).toEqual(
        expect.arrayContaining(["users", "meetings", "meeting_join_tokens"]),
      );

      const [cols] = await db.query(
        `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
      );
      const names = (cols as Array<{ name: string }>).map((c) =>
        String(c.name).toLowerCase(),
      );
      expect(names).toEqual(
        expect.arrayContaining(["role", "status", "phone", "updated_at"]),
      );
    }
  });

  it.runIf(driver === "mysql")(
    "adds admin columns to a legacy users table via 002 upgrade",
    async () => {
      await db.query("SET FOREIGN_KEY_CHECKS = 0");
      await db.query("DROP TABLE IF EXISTS meeting_join_tokens");
      await db.query("DROP TABLE IF EXISTS meetings");
      await db.query("DROP TABLE IF EXISTS users");
      await db.query("SET FOREIGN_KEY_CHECKS = 1");

      await db.query(`
      CREATE TABLE users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(64) NOT NULL,
        password_hash VARCHAR(100) NOT NULL,
        display_name VARCHAR(64) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_users_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

      await migrate(db);

      const [cols] = await db.query(
        `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
      );
      const names = (cols as Array<{ name: string }>).map((c) =>
        String(c.name).toLowerCase(),
      );
      expect(names).toEqual(
        expect.arrayContaining(["role", "status", "phone", "updated_at"]),
      );
    },
  );
});
