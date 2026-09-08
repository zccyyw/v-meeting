# serve/sql — 数据库最新表结构

本目录存放**三种数据库的最新完整表结构**（与 `serve/api/src/sql/<driver>/` 迁移全部执行后的最终态一致）：

| 文件 | 数据库 | 生成方式 |
|------|--------|---------|
| `schema-sqlite.sql` | SQLite 3 | 从实际执行全部迁移后的数据库导出（**权威**，含索引与触发器） |
| `schema-mysql.sql` | MySQL 8 | 合并 `serve/api/src/sql/mysql/` 全部迁移的建表语句 + `migrate.ts` 中的动态列（`sys_user` 表、`meetings.record_allowed`、`sys_oper_log.oper_object/classification`） |
| `schema-postgres.sql` | PostgreSQL 12+ | 同上（postgres 方言） |

**表清单（18 张，三方言一致）**：
`meetings` `meeting_invitations` `meeting_join_tokens` `meeting_applications` `meeting_groups` `meeting_group_members` `recordings` `users`¹ `sys_user` `sys_dept` `sys_role` `sys_menu` `sys_user_role` `sys_role_menu` `sys_config` `sys_notice` `sys_oper_log` `sys_user_approval`

> ¹ `users` 为 v0.0.7 之前的旧用户表，仅作迁移兼容保留（新环境初始化后为空表，业务实际使用 `sys_user`）。

## 用途

- **全新环境初始化**：直接在目标库执行对应 schema 文件即可建立全部表结构（初始数据——角色 / 菜单 / 三员账号 / 系统配置——仍由服务启动时的 seed 自动写入）
- **结构查阅 / 对比**：供 DBA 与开发核对表结构

## 注意

1. **生产升级不要用本目录**：已有环境请依赖服务启动时的自动迁移（`serve/api/src/sql/<driver>/00X_*.sql`，按序幂等执行），本目录是迁移执行后的**结果快照**，不含版本判断逻辑。
2. 重新生成：`node scripts/dump-schema.mjs sqlite|mysql|postgres`（mysql/postgres 需配置对应连接并可达；sqlite 本地即可）。
3. 新增迁移（`0XX_*.sql` 或 `migrate.ts` 中的动态迁移）后，需**重新生成**本目录文件以保持同步。
