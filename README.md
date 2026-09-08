# Meeting — 浏览器端视频会议系统

一个可内网部署、基于 WebRTC 的视频会议系统。采用 mediasoup SFU 架构，前端为 PWA，支持快速会议、预约会议（含审批流）、等候室、屏幕共享、主持人管控、实时聊天与弹幕等能力，**适配信创国产化环境**（银河麒麟、统信 UOS、中科方德，x86_64 / aarch64 / loongarch64，全离线部署）。

## 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Vite 8 + TypeScript | PWA，Ant Design 6，构建目标 ES2020（兼容国产浏览器老内核） |
| WebRTC 客户端 | mediasoup-client 3.21 | 与服务端 SFU 配合，支持 VP8 / H264 |
| 国际化 | i18next + react-i18next | 中英文双语 |
| 信令服务 | Node.js + ws + mediasoup 3.22 | WebSocket 信令 + SFU 媒体转发 |
| API 服务 | Fastify 5 + TypeScript | 账号、会议、令牌、用户管理 |
| 数据库 | SQLite（默认，零依赖）/ MySQL 8 / PostgreSQL 12 | 由 `DB_DRIVER` / `COMPOSE_PROFILES` 决定 |
| 缓存/会话 | Redis 7（默认内存模式，零依赖） | 登录会话、房间瞬时状态 |
| 共享协议 | Zod | 前后端复用的消息校验 |
| 反向代理 | Caddy 2 / Nginx | 生产 HTTPS 终结 |
| 部署 | Docker 镜像（推荐）/ RPM / DEB / 离线 tar 包 | 适配在线与内网无外网环境 |

## 目录结构

```
meeting/
├── front/                 # 前端（Vite + React + PWA）
├── serve/
│   ├── api/               # REST API（Fastify）：账号/会议/用户管理/审批
│   ├── realtime/          # WebSocket 信令 + mediasoup SFU
│   ├── shared/            # 前后端共享 Zod 协议、类型、AES 加解密
│   ├── db/                # SQLite / MySQL / PostgreSQL 适配层
│   └── sql/               # 若依（RuoYi）初始 SQL
├── deploy/
│   ├── docker/            # Caddy / Nginx 配置 + 自签证书生成
│   ├── native/            # 离线发布包：install.sh + systemd + gateway + 配置工具
│   └── rpm/               # RPM / DEB 打包（builder 镜像与脚本，两者共用）
├── scripts/               # 打包（pack*）与开发脚本
├── docs/
│   ├── 项目打包与部署说明.md   # 部署主文档（首次安装 / 升级）
│   ├── 项目功能说明.md
│   ├── 需求实现说明.md        # 需求实现分析 + 改造设计
│   ├── 信创适配方案.md        # 信创环境适配方案
│   ├── 变更日志.md
│   ├── install/           # 按部署方式拆分（md + docx，脚本生成）
│   ├── tests/             # 测试用例与测试报告
│   └── customer/          # 客户资料（需求文档、系统说明、竞品对比）
├── client/                # 预留：未来原生 / 桌面客户端
├── docker-compose.yml     # 统一编排（SQLite/MySQL/PG 由 profiles 切换）
├── Caddyfile              # 生产反向代理配置
└── .env.example           # 本地开发环境变量模板
```

> 💡 数据库与缓存**默认零依赖**（SQLite + 内存 Redis），无需安装 MySQL / Redis 即可运行。

## 快速开始（本地开发）

### 前置条件

- Node.js ≥ 20
- 数据库：默认 SQLite（零依赖），可选 MySQL 8 / PostgreSQL 12
- Redis：默认内存模式（零依赖），可选 Redis 7
- Chrome / Edge / 奇安信浏览器等 Chromium 内核浏览器

### 步骤

```bash
# 1. 安装依赖（npm workspaces 会一并安装所有子包）
npm install

# 2. 构建共享包（shared / db）
npm run build:shared

# 3. 配置环境变量
cp .env.example .env
#   特别注意 MEDIASOUP_ANNOUNCED_IP：仅本机访问用 127.0.0.1，
#   局域网其他机器访问需改成本机局域网 IP

# 4. 执行数据库迁移（SQLite 无需建库）
npm run migrate

# 5. 写入默认管理员
npm run seed

# 6. 启动三个服务（API / Realtime / 前端）
npm run dev
```

浏览器访问 `http://localhost:8081`，默认账号 `admin / admin123`。

> Windows 也可用 `powershell scripts/dev.ps1` 一键启动。

### 端口说明

| 服务 | 默认端口 | 环境变量 |
|------|---------|---------|
| 前端 (Vite) | 8081 | `FRONT_PORT` |
| API (Fastify) | 8080 | `API_PORT` |
| 信令 (WebSocket) | 8082 | `WS_PORT` |
| 离线网关（RPM/DEB/Native） | 8088 | `GATEWAY_PORT` |
| mediasoup RTC | 40000-41000/udp | `RTC_MIN_PORT` / `RTC_MAX_PORT` |

> ⚠️ 云平台安全组需**单独放行 UDP 40000-41000 入方向**，否则能进会议但看不到/听不到对方。

## 功能清单

**会议能力**
- 快速会议（即时入会）
- **预约会议（审批流）**：提交申请（时间 / 地点 / 单位数量 / 优先级 高·中·低）→ 授权管理员审批 → 批准后发起会议；快速会议不受此限制
- 加入会议（会议号 / 历史记录），支持会议号邀请链接
- 等候室与批准入会（主持人可动态开关）
- 宫格 / 演讲者 / 培训布局切换
- **主讲人画面小窗（PIP）**：默认悬浮右下角，可拖动
- **培训模式**：主画面 + 参会者列表，列表可收缩 / 拖动；仅主持人可切换发言者画面
- **屏幕共享**：共享全屏时自动不渲染本地预览（避免无限嵌套画面），可开启「沉浸模式」用小窗看参会者
- 举手、会议录制（Canvas 合成宫格画面上传，主持人可控制参会者录制权限）
- 群组管理：一键群组开会、**常用分组置顶**

**音视频**
- 麦克风 / 摄像头开关，设备切换
- 说话指示（绿色声波条动画，基于 Web Audio API）
- 静音状态同步
- 默认入会关闭摄像头

**互动**
- 实时群聊（微信式气泡布局）
- 弹幕（开关、多轨道防覆盖、悬停暂停）
- 未读消息角标

**主持人管控**
- 全体静音 / 解除静音、移出成员
- 允许 / 禁止成员共享屏幕
- 开启 / 关闭参会者录制权限（默认关闭）
- 结束会议

**用户管理与安全合规**
- 管理员后台（RBAC，若依风格：用户 / 部门 / 角色 / 菜单 / 参数 / 公告）
- 用户 CRUD、启用停用、Excel 批量导入导出
- **三员分立**：系统管理员（管用户）、授权管理员（审批）、审计管理员（仅看日志）
- 密码策略（≥10 位、复杂度、15 天过期、首登/弱口令强制改密）、密码 AES-GCM 加密传输
- 登录失败 5 次锁定 1 分钟、操作日志（可按字段查询 / 导出 / 保留期配置）
- 页面空闲超时自动退出（默认 10 分钟，会议中除外）
- 系统在线人数限制（默认 20，仅 system 可见可配）

**其他**
- 中英文双语、PWA 离线缓存、录制列表

## 文档

| 文档 | 内容 |
|------|------|
| [项目打包与部署说明](docs/项目打包与部署说明.md) | 部署主文档（构建产物、首次安装、升级、故障排查） |
| [项目功能说明](docs/项目功能说明.md) | 功能模块详解 |
| [需求实现说明](docs/需求实现说明.md) | 需求实现现状 + 改造设计 |
| [信创适配方案](docs/信创适配方案.md) | 信创环境（麒麟 / UOS / 方德）适配方案 |
| [变更日志](docs/变更日志.md) | 版本变更记录 |
| `docs/install/` | 按部署方式拆分的部署文档（含 docx，可交付客户） |
| `docs/tests/` | 测试用例与测试报告 |
| `docs/customer/` | 客户提供的资料（需求、系统说明、竞品对比） |

## 生产部署

**推荐顺序**：Docker 镜像 → RPM / DEB 包 → 离线 tar 包，详见[项目打包与部署说明](docs/项目打包与部署说明.md)。

| 方式 | 适用 | 首次安装 | 升级 |
|------|------|---------|------|
| **Docker 镜像** ⭐ | 有 Docker（x64/aarch64） | `bash load-images.sh` → 配 `.env` → `docker-compose up -d` | 加载新镜像 → `docker-compose up -d` |
| **RPM 包** | 银河麒麟 / 中科方德 / openEuler | `rpm -ivh meeting-*.rpm` → `configure.mjs` → `systemctl enable --now ...` | `rpm -Uvh` → 重启服务 |
| **DEB 包** | 统信 UOS / 方德 DEB 系 / Debian | `dpkg -i meeting-*.deb` → 同上 | `dpkg -i` → 重启服务 |
| **离线 tar 包** | 无 Docker 的通用 Linux | `tar -xzf` → `sudo ./install.sh` | 解压新包 → `sudo ./install.sh` |

> 升级通用原则：先备份（数据库 + `.env`）；配置与数据目录自动保留；服务启动时**自动执行数据库迁移**；升级后按文档检查清单验收。

快速启动（Docker Compose，默认 SQLite 零依赖，自动初始化）：

```bash
cp .env.production.example .env
# 编辑 .env，至少改 MEDIASOUP_ANNOUNCED_IP 为服务器 IP
docker-compose up -d --build
# 访问 https://localhost
```

> 📌 `docker-compose.yml` 使用 `profiles` 与 `depends_on.required: false`，需要 **Docker Compose v2.20+**；麒麟 V10 SP1 等自带旧版 Docker 的环境，请使用离线包附带的 compose v2 二进制或改用 RPM / DEB 包。

## 打包与构建

项目支持 5 种打包方式，统一由 **GitHub Actions** 构建（推送 `v*` tag 后自动并行构建 x64 与 arm64，各使用同架构原生 runner，约 30 分钟产出全部产物）。

| # | 方式 | 本地命令 | 产物 | 适用 |
|---|------|---------|------|------|
| 1 | 源码打包 | `npm run pack` | `dist/` | 编译产物归档 |
| 2 | Docker 离线包 ⭐ | `npm run pack:docker` | `.tar` 镜像 + compose | 有 Docker 的目标环境 |
| 3 | Native 离线包 | `npm run pack:native` | `.tar.gz` | 无 Docker，tar 解压安装 |
| 4 | RPM 包 | `npm run pack:rpm` | `.rpm` | 银河麒麟 / 中科方德 / openEuler |
| 5 | DEB 包 | （由 RPM 转换，CI 自动生成） | `.deb` | 统信 UOS / 方德 DEB 系 / Debian |

### 触发构建

```bash
# Tag 触发（推荐）：自动构建两种架构的全部产物
git tag v0.0.9 && git push origin v0.0.9
```

或 GitHub → **Actions → Build Packages → Run workflow**（可选 `build_type` 与 `target_arch`）。

### 下载与安装

构建完成后在 **Actions → 运行详情 → Artifacts** 下载：

| 构建方式 | Artifact 名称 |
|---------|--------------|
| 源码打包 | `meeting-pack-{version}-{release}` |
| Docker 离线包 | `meeting-docker-{arch}-{version}-{release}` |
| Native 离线包 | `meeting-native-{arch}-{version}-{release}` |
| RPM 包 | `meeting-rpm-{arch}-{version}-{release}` |
| DEB 包 | `meeting-deb-{arch}-{version}-{release}` |

```bash
# ── RPM（麒麟 / 方德 / openEuler）──
sudo rpm -ivh meeting-*.x86_64.rpm          # arm64 用 aarch64.rpm
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway

# ── DEB（UOS / 方德 DEB 系）──
sudo dpkg -i meeting-*.deb
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway

# ── Native 离线包 ──
tar -xzf meeting-linux-*.tar.gz && cd meeting-linux-*/ && sudo ./install.sh

# ── Docker 离线包 ──
bash load-images.sh && cp .env.example .env && vi .env && docker-compose up -d

# ── 配置（RPM/DEB/Native 通用）──
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs

# 验证
curl -k https://127.0.0.1:8088/api/healthz
```

> **注意**：安装包架构必须与目标服务器 CPU 架构一致（x64 → 海光/兆芯，arm64 → 鲲鹏/飞腾）。

## 信创适配

已适配国产服务器与客户端环境，详见[信创适配方案](docs/信创适配方案.md)：

- **服务器**：银河麒麟 V10（SP1 起）、中科方德 —— x86_64 / aarch64 / loongarch64（龙芯排第三优先级）
- **客户端**：奇安信浏览器（涉密版）、UOS 浏览器等 Chromium 内核浏览器（前端构建目标 ES2020）
- **离线**：全自包含交付（内嵌 Node.js、前端静态资源、证书工具纯 JS 实现，不依赖外网）
- **服务单元**：兼容 systemd 219（麒麟 V10 SP1），日志写入 `/opt/meeting/logs/*.log`
- **安全**：支持 CA 签发证书（`gen-cert.mjs --ca <IP>`），适配涉密浏览器信任策略

## 默认账号

执行 `npm run seed` 后创建（seed 幂等，可重复执行）：

| 用户名 | 密码 | 昵称 | 角色 | 说明 |
|--------|------|------|------|------|
| `admin` | `admin123` | 管理员 | 超级管理员 (role_id=1) | 拥有所有权限 |
| `system` | `System@123` | 系统用户 | 超级管理员 (role_id=1) | 隐藏用户，仅用于系统级操作 |
| `sysadmin` | `Admin@123` | 系统管理员 | 系统管理员 (role_id=3) | 三员之一，管理用户与配置 |
| `authadmin` | `Admin@123` | 授权管理员 | 授权管理员 (role_id=4) | 三员之一，会议 / 用户审批 |
| `auditadmin` | `Admin@123` | 审计管理员 | 审计管理员 (role_id=5) | 三员之一，仅查看操作日志 |
| `meeting` | `Admin@123` | 普通用户 | 普通用户 (role_id=2) | 仅会议功能 |

> ⚠️ 生产环境部署后请立即修改所有默认密码。三员分立：系统管理员管用户但不能审批；授权管理员审批但不能直接操作用户；审计管理员仅查看日志。
> 💡 生产交付包**不再创建** `test1-test5` 测试账号；本地开发需要时可设 `SEED_TEST_USERS=1` 后执行 seed。
