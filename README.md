# Meeting — 浏览器端视频会议系统

一个可内网部署、基于 WebRTC 的视频会议系统。采用 mediasoup SFU 架构，前端为 PWA，支持快速会议、预约会议、等候室、屏幕共享、主持人管控、实时聊天与弹幕等能力，适配国产化（麒麟 / UOS）离线发布场景。

## 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Vite 8 + TypeScript | PWA，Ant Design 6 + lucide-react 图标 |
| WebRTC 客户端 | mediasoup-client 3.21 | 与服务端 SFU 配合 |
| 国际化 | i18next + react-i18next | 中英文双语 |
| 信令服务 | Node.js + ws + mediasoup 3.14 | WebSocket 信令 + SFU 媒体转发 |
| API 服务 | Fastify 5 + TypeScript | 账号、会议、令牌、用户管理 |
| 数据库 | SQLite（默认，零依赖）/ MySQL 8 / PostgreSQL 12（可切换） | 由 `COMPOSE_PROFILES` 决定 |
| 缓存/会话 | Redis 7 | 登录会话、房间瞬时状态 |
| 共享协议 | Zod | 前后端复用的消息校验 |
| 反向代理 | Caddy 2 / Nginx | 生产 HTTPS 终结 |
| 部署 | Docker Compose / 离线 tar 包 | 适配在线与内网无外网环境 |

## 目录结构

```
meeting/
├── front/                 # 前端（Vite + React + PWA）
├── serve/
│   ├── api/               # REST API（Fastify）：账号/会议/用户管理
│   ├── realtime/          # WebSocket 信令 + mediasoup SFU
│   ├── shared/            # 前后端共享 Zod 协议与类型
│   └── db/                # MySQL/PostgreSQL 适配层
├── deploy/
│   ├── docker/            # Caddy/Nginx 配置 + 自签证书生成
│   └── native/            # 离线包：install.sh + systemd + gateway
├── scripts/               # 打包与开发脚本
├── docs/                  # 项目文档
├── docker-compose.yml              # 默认入口（docker-compose up 直接读）
├── docker-compose.prod.yml         # 生产编排（SQLite/MySQL/PG/Redis/api/realtime/web/caddy）
├── docker-compose.postgres.yml     # PostgreSQL overlay（旧式 -f 调用可选）
├── Caddyfile                      # 生产反向代理配置
└── .env.example                   # 本地开发环境变量模板
```

## 快速开始（本地开发）

### 前置条件

- Node.js ≥ 20
- MySQL 8 或 PostgreSQL 12
- Redis 7
- Chrome / Edge 浏览器

### 步骤

```bash
# 1. 安装依赖（npm workspaces 会一并安装所有子包）
npm install

# 2. 构建共享包（shared / db）
npm run build:shared

# 3. 配置环境变量
cp .env.example .env
#   按本机实际情况修改 .env 中的数据库连接、Redis、端口等
#   特别注意 MEDIASOUP_ANNOUNCED_IP：仅本机访问用 127.0.0.1，
#   局域网其他机器访问需改成本机局域网 IP

# 4. 创建数据库（MySQL 示例）
#   CREATE DATABASE `meeting-weishi` CHARACTER SET utf8mb4;
#   PostgreSQL: createdb meeting-weishi

# 5. 执行数据库迁移
npm run migrate

# 6. 写入默认管理员
npm run seed

# 7. 启动三个服务（API / Realtime / 前端）
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
| mediasoup RTC | 40000-41000/udp | `RTC_MIN_PORT` / `RTC_MAX_PORT` |

## 功能清单

**会议能力**
- 快速会议、预约会议、加入会议（会议号 / 历史记录）
- 等候室与批准入会（主持人可在会议中动态开关）
- 会议入会密码（预约会议可设）
- 宫格 / 演讲者布局切换
- 屏幕共享（自动检测全屏/窗口共享并消除嵌套回环）
- 举手
- 会议录制（Canvas 合成宫格画面，上传服务端存储，主持人可控制参会者录制权限）

**音视频**
- 麦克风 / 摄像头开关，设备切换
- 说话指示（绿色声波条动画，基于 Web Audio API 音量检测）
- 静音状态同步（其他用户可见静音图标）
- 默认入会关闭摄像头

**互动**
- 实时群聊（微信式气泡布局，头像左右分列）
- 弹幕（设置开关，多轨道防覆盖，鼠标悬停暂停）
- 未读消息角标

**主持人管控**
- 全体静音 / 解除静音
- 移出成员
- 允许 / 禁止成员共享屏幕
- 开启 / 关闭参会者录制权限（默认关闭）
- 结束会议

**用户管理**
- 管理员后台（仅 admin 可见）
- 用户 CRUD、启用 / 停用
- Excel 批量导入导出
- 修改密码

**其他**
- 中英文双语切换
- PWA 离线缓存
- 录制列表（RecordingsPage）

## 文档

详细文档位于 `docs/` 目录：

- [项目可行性报告](docs/项目可行性报告.md)
- [项目功能说明](docs/项目功能说明.md)
- [项目升级说明](docs/项目升级说明.md)
- [项目打包与部署说明](docs/项目打包与部署说明.md)

## 生产部署

生产部署支持两种方式，详见[项目打包与部署说明](docs/项目打包与部署说明.md)：

- **Docker Compose**：适合有 Docker 环境的服务器，一条命令拉起全部服务
- **离线发布包**：适合内网无外网环境（麒麟 / UOS / 通用 Linux），同架构打包后安装

快速启动（Docker Compose，默认 SQLite 零依赖，自动初始化）：

```bash
cp .env.production.example .env
# 编辑 .env，至少改 MEDIASOUP_ANNOUNCED_IP 为服务器公网/局域网 IP
docker-compose up -d --build
# 访问 https://localhost
```

## 打包与构建

项目支持 5 种打包方式，全部可通过 GitHub Actions 远程构建，也可在本地执行。

### 打包方式一览

| # | 方式 | 命令 | 产物 | 适用场景 |
|---|------|------|------|----------|
| 1 | 源码打包 | `npm run pack` | `dist/` 目录 | 编译产物归档，手动部署 |
| 2 | Docker 离线包 | `npm run pack:docker` | `.tar` 镜像包 | 有 Docker 的目标环境 |
| 3 | Native 离线包 | `npm run pack:native` | `.tar.gz` | 无 Docker，tar 解压安装 |
| 4 | RPM 包 | `npm run pack:rpm` | `.rpm` | CentOS / 麒麟 / 中科方德 |
| 5 | DEB 包 | fpm 转换 | `.deb` | Ubuntu / Deepin / UOS |

---

### GitHub Actions 远程构建（推荐，无需本地 Linux 环境）

项目已内置 `.github/workflows/build-rpm.yml`，推送到 GitHub 仓库后自动可用，支持全部 5 种打包方式。

#### 触发方式

**手动触发**（推荐）：

1. 进入 GitHub 仓库 → **Actions** 标签页
2. 左侧 **Workflows** 列表中找到 **Build Packages**（文件名为 `build-rpm.yml`）
   > 如果左侧列表看不到该 workflow，请确保 `.github/workflows/build-rpm.yml` 已提交到仓库**默认分支**（如 `main`/`master`）。GitHub Actions 仅显示默认分支上的 workflow。
3. 点击右侧 **Run workflow** 按钮，选择参数：
   - `build_type`：打包方式 — `all`（全部）、`pack`、`docker`、`native`、`rpm`、`deb`
   - `target_arch`：目标 CPU 架构（`x64` 或 `arm64`）
   - `version`：版本号（如 `0.1`）
   - `release`：发布号（如 `1`）
4. 点击绿色 **Run workflow** 按钮确认，等待构建完成

**Tag 触发**：

```bash
git tag v0.2
git push origin v0.2
```

推送 `v*` 格式的 tag 会自动触发 x64 和 arm64 两个架构的全量构建（5 种包全部生成）。

#### 下载产物

构建完成后（约 5–15 分钟，取决于选择的打包方式）：

1. 在 Actions 运行详情页底部找到 **Artifacts** 区
2. 根据构建方式下载对应的压缩包：

| 构建方式 | Artifact 名称 |
|---------|--------------|
| 源码打包 | `meeting-pack-{version}-{release}` |
| Docker 离线包 | `meeting-docker-{arch}-{version}-{release}` |
| Native 离线包 | `meeting-native-{arch}-{version}-{release}` |
| RPM 包 | `meeting-rpm-{arch}-{version}-{release}` |
| DEB 包 | `meeting-deb-{arch}-{version}-{release}` |

#### 安装到目标服务器

```bash
# ── RPM 包（CentOS / 麒麟 / 中科方德 / UOS）──
sudo rpm -ivh meeting-*.x86_64.rpm       # x64
sudo rpm -ivh meeting-*.aarch64.rpm      # arm64
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway

# ── DEB 包（Ubuntu / Deepin / UOS）──
sudo dpkg -i meeting-*.amd64.deb         # x64
sudo dpkg -i meeting-*.arm64.deb         # arm64
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway

# ── Native 离线包（tar.gz + install.sh）──
tar -xzf meeting-linux-*.tar.gz
cd meeting-linux-*/
sudo ./install.sh

# ── Docker 离线包（.tar 镜像）──
bash load-images.sh
cp .env.example .env && vi .env
docker-compose up -d

# ── 配置（RPM/DEB/Native 通用）──
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs

# 验证
curl -k https://127.0.0.1:8088/api/healthz
```

> **注意**：安装包架构必须与目标服务器 CPU 架构一致。x64 包不能装到 arm64 机器上，反之亦然。

---

### 本地构建

在本地有 Linux 或 Docker 环境时，可直接执行打包命令：

#### 源码打包

```bash
npm run pack
# 产物：dist/ 目录（shared / db / api / realtime / front 编译产物）
```

#### Docker 离线包

```bash
npm run pack:docker
# 产物：dist/docker/ 目录（.tar 镜像 + compose 文件 + load-images.sh）

# ARM64 构建
DOCKER_PLATFORM=linux/arm64 npm run pack:docker
```

#### Native 离线包（需在 Linux 上执行）

```bash
npm run pack:native
# 产物：dist/native/meeting-linux-{arch}-{date}.tar.gz
```

#### RPM 包

```bash
# Docker 模式（默认，推荐）
npm run pack:rpm
# 产物：dist/rpm/meeting-*.rpm

# ARM64 构建
TARGET_ARCH=arm64 npm run pack:rpm

# 原生模式（无需 Docker，需 Linux + rpmbuild/fpm）
NO_DOCKER=1 USE_SYSTEM_NODE=1 npm run pack:rpm

# 中国镜像加速
USE_CN_MIRROR=1 npm run pack:rpm

# 原生模式 + 中国镜像
NO_DOCKER=1 USE_CN_MIRROR=1 USE_SYSTEM_NODE=1 npm run pack:rpm
```

> 更详细的本地构建说明参见 [项目打包与部署说明](docs/项目打包与部署说明.md)。

## 默认账号

执行 `npm run seed` 后，系统会创建以下默认账号：

| 用户名 | 密码 | 昵称 | 角色 | 说明 |
|--------|------|------|------|------|
| `admin` | `admin123` | 管理员 | 超级管理员 (role_id=1) | 拥有所有权限，首次登录提示修改密码 |
| `system` | `System@123` | 系统用户 | 超级管理员 (role_id=1) | 隐藏用户，对非 system 用户不可见，用于系统级操作 |
| `sysadmin` | `Admin@123` | 系统管理员 | 系统管理员 (role_id=3) | 三员之一，管理系统配置 |
| `authadmin` | `Admin@123` | 授权管理员 | 授权管理员 (role_id=4) | 三员之一，管理用户审批 |
| `auditadmin` | `Admin@123` | 审计管理员 | 审计管理员 (role_id=5) | 三员之一，管理操作审计 |
| `meeting` | `Admin@123` | 普通用户 | 普通用户 (role_id=2) | 仅会议功能，无管理后台权限 |

> ⚠️ 生产环境部署后请立即修改所有默认密码。