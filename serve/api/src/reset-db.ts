import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Db } from "./db.js";
import { migrate } from "./migrate.js";
import { seedAdmin } from "./seed-admin.js";

/** Drop all app tables then migrate + seed. Destructive. */
export async function resetDb(db?: Db) {
  if (!db) db = await createPool();
  if (db.driver === "postgres") {
    await db.query("DROP TABLE IF EXISTS meeting_applications CASCADE");
    await db.query("DROP TABLE IF EXISTS meeting_group_members CASCADE");
    await db.query("DROP TABLE IF EXISTS meeting_groups CASCADE");
    await db.query("DROP TABLE IF EXISTS meeting_invitations CASCADE");
    await db.query("DROP TABLE IF EXISTS recordings CASCADE");
    await db.query("DROP TABLE IF EXISTS meeting_join_tokens CASCADE");
    await db.query("DROP TABLE IF EXISTS meetings CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_user_role CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_role_menu CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_oper_log CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_notice CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_config CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_menu CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_role CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_dept CASCADE");
    await db.query("DROP TABLE IF EXISTS sys_user CASCADE");
    await db.query("DROP TABLE IF EXISTS users CASCADE");
    await db.query("DROP FUNCTION IF EXISTS meeting_set_updated_at() CASCADE");
  } else if (db.driver === "sqlite") {
    await db.query("DROP TRIGGER IF EXISTS trg_users_updated_at");
    await db.query("DROP TRIGGER IF EXISTS trg_sys_user_update_time");
    await db.query("DROP TABLE IF EXISTS meeting_applications");
    await db.query("DROP TABLE IF EXISTS meeting_group_members");
    await db.query("DROP TABLE IF EXISTS meeting_groups");
    await db.query("DROP TABLE IF EXISTS meeting_invitations");
    await db.query("DROP TABLE IF EXISTS recordings");
    await db.query("DROP TABLE IF EXISTS meeting_join_tokens");
    await db.query("DROP TABLE IF EXISTS meetings");
    await db.query("DROP TABLE IF EXISTS sys_user_role");
    await db.query("DROP TABLE IF EXISTS sys_role_menu");
    await db.query("DROP TABLE IF EXISTS sys_oper_log");
    await db.query("DROP TABLE IF EXISTS sys_notice");
    await db.query("DROP TABLE IF EXISTS sys_config");
    await db.query("DROP TABLE IF EXISTS sys_menu");
    await db.query("DROP TABLE IF EXISTS sys_role");
    await db.query("DROP TABLE IF EXISTS sys_dept");
    await db.query("DROP TABLE IF EXISTS sys_user");
    await db.query("DROP TABLE IF EXISTS users");
  } else {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    await db.query("DROP TABLE IF EXISTS meeting_applications");
    await db.query("DROP TABLE IF EXISTS meeting_group_members");
    await db.query("DROP TABLE IF EXISTS meeting_groups");
    await db.query("DROP TABLE IF EXISTS meeting_invitations");
    await db.query("DROP TABLE IF EXISTS recordings");
    await db.query("DROP TABLE IF EXISTS meeting_join_tokens");
    await db.query("DROP TABLE IF EXISTS meetings");
    await db.query("DROP TABLE IF EXISTS sys_user_role");
    await db.query("DROP TABLE IF EXISTS sys_role_menu");
    await db.query("DROP TABLE IF EXISTS sys_oper_log");
    await db.query("DROP TABLE IF EXISTS sys_notice");
    await db.query("DROP TABLE IF EXISTS sys_config");
    await db.query("DROP TABLE IF EXISTS sys_menu");
    await db.query("DROP TABLE IF EXISTS sys_role");
    await db.query("DROP TABLE IF EXISTS sys_dept");
    await db.query("DROP TABLE IF EXISTS sys_user");
    await db.query("DROP TABLE IF EXISTS users");
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  const n = await migrate(db);
  const seedResult = await seedAdmin(db);
  return { migrated: n, seeded: seedResult.seeded };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  resetDb()
    .then((r) => {
      console.log(`reset ok: migrated ${r.migrated} statements, ${r.seeded.length} users seeded (${r.seeded.join(", ")})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
