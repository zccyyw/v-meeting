# CodeGraph 静态可视化

从 CodeGraph 索引生成统计与**模块级依赖图**（按目录聚合，解析 `@/`、`@meeting/shared`、相对路径等到已索引文件）。

## 生成数据

在**仓库根目录**执行：

```bash
npm run codegraph:viz
```

或：

```bash
node .codegraph/scripts/export-viz.mjs
```

依赖：

- 已执行 `codegraph init`（存在 `.codegraph/codegraph.db`）
- `PATH` 中能运行 `codegraph`（与日常 CLI 一致）

产物：

- `data/status.json` —— 与 `codegraph status -j` 相同
- `data/graph.json` —— 节点/边供页面绘制

## 查看页面

**不要**用浏览器直接打开 `file:///.../index.html`（`fetch` 读本地 JSON 会被限制）。

在仓库根目录任选一种：

```bash
npx serve .codegraph/viz
```

或指定端口：

```bash
npx serve .codegraph/viz -p 8099
```

浏览器访问终端里提示的地址即可。

## 说明

- 图为「模块」粒度（如 `front/src/pages`、api 侧目录等），边权重为解析到的文件间 import 条数之和；仅保留总度数最高的若干模块以防卡顿。
- 未解析的外部包（如 `react`）不计入边，统计中的「未解析」计数会体现在页面文案中。
