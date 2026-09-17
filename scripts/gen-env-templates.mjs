#!/usr/bin/env node
/**
 * 从 config/env.schema.mjs 生成（或校验）三份环境变量模板：
 *   dev    → .env.example
 *   host   → deploy/native/conf/env.example
 *   docker → .env.production.example
 *
 * 用法：
 *   node scripts/gen-env-templates.mjs          # 写入（生成产物，勿手工编辑）
 *   node scripts/gen-env-templates.mjs --check  # 只校验是否与 schema 一致（CI 用，不一致退出 1）
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADERS, SCHEMA, TARGETS, TARGET_FILES } from "../config/env.schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALL = TARGETS;

const BANNER = "# ──────────────────────────────────────";

function resolveActive(active, target) {
  if (active === undefined) return true;
  if (typeof active === "object") return active[target] ?? true;
  return Boolean(active);
}

function render(target) {
  const lines = [...HEADERS[target]];

  for (const entry of SCHEMA) {
    const targets = entry.targets ?? ALL;
    if (!targets.includes(target)) continue;

    if (entry.section) {
      lines.push("", BANNER, `# ${entry.section}`, BANNER);
      continue;
    }
    if (!entry.key) {
      // 纯说明条目（无变量）：只输出注释，用于解释该端的隐式约定
      for (const c of entry.comment ?? []) lines.push(`# ${c}`);
      continue;
    }

    const value = typeof entry.value === "string" ? entry.value : entry.value?.[target];
    if (value === undefined) {
      throw new Error(`schema 缺少 ${target} 端取值：${entry.key}`);
    }
    for (const c of entry.comment ?? []) lines.push(`# ${c}`);
    const kv = `${entry.key}=${value}`;
    lines.push(resolveActive(entry.active, target) ? kv : `# ${kv}`);
  }

  return lines.join("\n") + "\n";
}

const check = process.argv.includes("--check");
let failed = 0;

for (const target of TARGETS) {
  const rel = TARGET_FILES[target];
  const file = join(root, rel);
  const want = render(target);
  const have = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;

  if (have === want) {
    console.log(`✓ ${rel}（${target}）与 schema 一致`);
    continue;
  }
  if (check) {
    console.error(`✗ ${rel}（${target}）与 config/env.schema.mjs 不一致`);
    console.error(`  请运行：node scripts/gen-env-templates.mjs`);
    failed = 1;
    continue;
  }
  writeFileSync(file, want);
  console.log(`→ 已生成 ${rel}（${target}）`);
}

process.exit(failed);
