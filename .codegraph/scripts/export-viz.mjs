/**
 * 生成 CodeGraph 可视化静态数据：
 * - viz/data/status.json  ← `codegraph status -j`
 * - viz/data/graph.json   ← 从 codegraph.db 聚合「模块级」依赖图（文件间 @/、workspace 包解析）
 *
 * 用法（仓库根目录）: node .codegraph/scripts/export-viz.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CODEGRAPH_DIR = path.join(REPO_ROOT, ".codegraph");
const DB_PATH = path.join(CODEGRAPH_DIR, "codegraph.db");
const VIZ_DIR = path.join(CODEGRAPH_DIR, "viz");
const DATA_DIR = path.join(VIZ_DIR, "data");

/** 概览规模：避免 vis-network 卡顿；需要更密可调大并重新导出 */
const TOP_MODULE_LIMIT = 28;
const MAX_EDGES = 120;

/** 与前端 tsconfig paths 一致：@/* -> front/src/* */
const FRONT_ALIAS_PREFIX = "@/";
const FRONT_SRC = "front/src";
const SHARED_PKG = "@meeting/shared";
const SHARED_MODULE_PREFIX = "serve/shared";

/**
 * 将文件路径映射为可视化「模块」节点 id（目录粒度，便于聚合）
 * @param {string} filePath repo 相对正斜杠路径
 */
function moduleKeyForFile(filePath) {
  const norm = filePath.replace(/\\/g, "/");
  if (norm.startsWith(`${FRONT_SRC}/`)) {
    const rel = norm.slice(FRONT_SRC.length + 1);
    const dir = path.posix.dirname(rel);
    return `front:${dir === "." ? "" : dir}`;
  }
  if (norm.startsWith("serve/api/src/")) {
    const rel = norm.slice("serve/api/src/".length);
    const dir = path.posix.dirname(rel);
    return `api:${dir === "." ? "" : dir}`;
  }
  if (norm.startsWith("serve/realtime/src/")) {
    const rel = norm.slice("serve/realtime/src/".length);
    const dir = path.posix.dirname(rel);
    return `realtime:${dir === "." ? "" : dir}`;
  }
  if (norm.startsWith("serve/shared/src/")) {
    const rel = norm.slice("serve/shared/src/".length);
    const dir = path.posix.dirname(rel);
    return `shared:${dir === "." ? "" : dir}`;
  }
  if (norm.startsWith("serve/db/src/")) {
    const rel = norm.slice("serve/db/src/".length);
    const dir = path.posix.dirname(rel);
    return `db:${dir === "." ? "" : dir}`;
  }
  const first = norm.split("/")[0] || "root";
  return `other:${first}`;
}

function labelForModuleKey(key) {
  return key.replace(/^front:/, "front/").replace(/^api:/, "api/").replace(/^realtime:/, "rt/").replace(/^shared:/, "shared/").replace(/^db:/, "db/").replace(/^other:/, "");
}

/**
 * @param {string} importName nodes.kind=import 的 name（如 @/foo、node:fs、./x）
 * @param {string} importerFilePath 当前文件 repo 相对路径
 * @param {Set<string>} fileSet 已索引文件集合
 */
function resolveImportToFile(importName, importerFilePath, fileSet) {
  const normImporter = importerFilePath.replace(/\\/g, "/");
  if (importName.startsWith("node:")) return null;
  if (importName.startsWith(FRONT_ALIAS_PREFIX)) {
    const sub = importName.slice(FRONT_ALIAS_PREFIX.length);
    const base = path.posix.join(FRONT_SRC, sub);
    return resolveWithExtensions(base, fileSet);
  }
  if (importName === SHARED_PKG || importName.startsWith(`${SHARED_PKG}/`)) {
    const sub = importName === SHARED_PKG ? "" : importName.slice(SHARED_PKG.length + 1);
    const base = sub
      ? path.posix.join("serve/shared/src", sub)
      : path.posix.join("serve/shared/src", "index");
    return resolveWithExtensions(base, fileSet);
  }
  if (importName.startsWith("./") || importName.startsWith("../")) {
    const dir = path.posix.dirname(normImporter);
    const base = path.posix.normalize(path.posix.join(dir, importName));
    return resolveWithExtensions(base, fileSet);
  }
  return null;
}

function resolveWithExtensions(base, fileSet) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.mts`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mjs`,
    `${base}/index.js`,
  ];
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeStatusJson() {
  // `codegraph status` 使用「路径」位置参数，不支持 -p（与 MCP 工具的 projectPath 不同）
  const r = spawnSync("codegraph", ["status", "-j", REPO_ROOT], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`codegraph status failed: ${r.stderr || r.stdout || r.status}`);
  }
  const json = r.stdout.trim();
  JSON.parse(json); // validate
  fs.writeFileSync(path.join(DATA_DIR, "status.json"), json + "\n", "utf8");
  return JSON.parse(json);
}

function buildModuleGraph() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`missing ${DB_PATH}; run codegraph init first`);
  }
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const fileRows = db.prepare("SELECT path FROM files").all();
  /** @type {Set<string>} */
  const fileSet = new Set(fileRows.map((r) => r.path.replace(/\\/g, "/")));

  const rows = db
    .prepare(
      `SELECT ns.file_path AS from_path, nt.name AS import_name
       FROM edges e
       JOIN nodes ns ON ns.id = e.source AND ns.kind = 'file'
       JOIN nodes nt ON nt.id = e.target AND nt.kind = 'import'
       WHERE e.kind = 'imports'`,
    )
    .all();

  /** @type {Map<string, number>} */
  const pairWeight = new Map();
  let resolvedEdges = 0;
  let skipped = 0;

  for (const row of rows) {
    const fromPath = String(row.from_path).replace(/\\/g, "/");
    const importName = String(row.import_name);
    const toPath = resolveImportToFile(importName, fromPath, fileSet);
    if (!toPath) {
      skipped += 1;
      continue;
    }
    const a = moduleKeyForFile(fromPath);
    const b = moduleKeyForFile(toPath);
    if (a === b) continue;
    const key = `${a}\0${b}`;
    pairWeight.set(key, (pairWeight.get(key) ?? 0) + 1);
    resolvedEdges += 1;
  }

  db.close();

  /** @type {Map<string, number>} */
  const degree = new Map();
  function addDeg(id, w) {
    degree.set(id, (degree.get(id) ?? 0) + w);
  }
  for (const [key, w] of pairWeight) {
    const [s, t] = key.split("\0");
    addDeg(s, w);
    addDeg(t, w);
  }

  const topIds = [...degree.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, TOP_MODULE_LIMIT)
    .map(([id]) => id);
  const topSet = new Set(topIds);

  /** @type {Array<{ source: string, target: string, weight: number }>} */
  const edges = [];
  for (const [key, w] of pairWeight) {
    const [s, t] = key.split("\0");
    if (!topSet.has(s) || !topSet.has(t)) continue;
    edges.push({ source: s, target: t, weight: w });
  }
  edges.sort((a, b) => b.weight - a.weight);
  const trimmed = edges.slice(0, MAX_EDGES);

  const nodes = topIds.map((id) => ({
    id,
    label: labelForModuleKey(id),
    group: id.split(":")[0] || "other",
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      topModuleLimit: TOP_MODULE_LIMIT,
      maxEdges: MAX_EDGES,
      importRows: rows.length,
      resolvedFileEdges: resolvedEdges,
      skippedUnresolved: skipped,
      nodeCount: nodes.length,
      edgeCount: trimmed.length,
    },
    nodes,
    edges: trimmed,
  };
}

function main() {
  ensureDir(DATA_DIR);
  const status = writeStatusJson();
  const graph = buildModuleGraph();
  fs.writeFileSync(path.join(DATA_DIR, "graph.json"), JSON.stringify(graph, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        status: {
          fileCount: status.fileCount,
          nodeCount: status.nodeCount,
          edgeCount: status.edgeCount,
        },
        graph: graph.summary,
        out: DATA_DIR,
      },
      null,
      2,
    ),
  );
}

main();
