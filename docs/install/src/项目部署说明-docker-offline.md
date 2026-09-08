# 项目部署说明 - 离线 Docker 镜像

## 一、服务器配置要求

| 配置项 | 最低配置 | 推荐配置 | 说明 |
| --- | --- | --- | --- |
| 内存 | 8 GB | 16 GB 以上 | mediasoup 媒体处理和并发会议数决定内存占用 |
| 磁盘 | 100 GB | 200 GB 以上 | 系统 + 应用 + 数据库 + 录制文件存储 |
| CPU | 4 核 | 8 核以上 | mediasoup C++ worker 需要一定算力 |
| 网络 | 百兆 | 千兆以上 | WebRTC 音视频对带宽和延迟敏感 |

## 二、操作系统与架构要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Linux | CentOS 7+、Ubuntu 20.04+、麒麟 V10、UOS、中科方德等；需安装 Docker 20+ |
| CPU 架构 | x86_64 或 aarch64（鲲鹏/飞腾） | 构建机与目标机必须相同 CPU 架构；mediasoup 原生模块不可跨架构 |
| Docker | 20+ + Compose v2.20+ | 目标机需预装 Docker |
| 构建机 | 同架构 Linux + Docker + Node.js 20+ | 需联网，用于打包镜像 |

## 三、安装说明

### 步骤 1 — 构建离线包（构建机，需联网与 Docker）

构建机要求：与目标机相同 CPU 架构，Node.js 20+（运行打包脚本），Docker 20+。

```bash
npm run pack:docker
# 产物：dist/docker/ 目录
# ARM64（如鲲鹏、飞腾）构建：
DOCKER_PLATFORM=linux/arm64 npm run pack:docker
```

产物内容：

```
dist/docker/
├── meeting-app-<platform>-latest.tar      # 应用镜像（api/realtime/web）
├── meeting-base-<platform>-latest.tar     # 基础镜像（mysql/pg/redis/caddy）
├── docker-compose.yml                      # 编排文件
├── docker-compose.yml
├── Caddyfile
├── .env.example
├── load-images.sh                          # 一键加载镜像
├── deploy/docker/gen-selfsigned.sh         # 证书生成脚本
└── README.txt
```

### 步骤 2 — 目标机部署

```bash
# 拷贝整个 dist/docker/ 目录到目标机后
cd dist/docker

# 1) 加载全部镜像
bash load-images.sh

# 2) 配置环境
cp .env.example .env
vi .env                    # 改 MEDIASOUP_ANNOUNCED_IP、数据库密码等

# 3) 生成证书（可选）
# 自签证书（内网测试）
bash deploy/docker/gen-selfsigned.sh <服务器IP>
# 或 CA 签发证书（信创环境推荐）
bash deploy/docker/gen-selfsigned.sh --ca <服务器IP>

# 4) 启动（默认 SQLite + 自动初始化）
docker-compose up -d
```

> 离线包内的 compose 文件与源码完全一致，docker-compose up -d 命令无需任何额外参数。

### 步骤 3 — 访问验证

| 项 | 地址 |
| --- | --- |
| 浏览器入口 | https://<服务器IP>/ |
| 默认账号 | admin / admin123（超级管理员）；另有三员账号见下方说明 |
| 健康检查 | curl -k https://127.0.0.1/api/healthz |

## 四、默认账号说明

系统初始化时自动创建以下账号：

| 账号 | 密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| admin | admin123 | 超级管理员 | 全部权限 |
| system | System@123 | 超级管理员 | 隐藏系统用户 |
| sysadmin | Admin@123 | 系统管理员 | 首次登录提示修改密码 |
| authadmin | Admin@123 | 授权管理员 | 首次登录提示修改密码 |
| auditadmin | Admin@123 | 审计管理员 | 首次登录提示修改密码 |
| meeting | Admin@123 | 普通用户 | 首次登录提示修改密码 |

> 生产环境部署后请立即修改所有默认密码。

## 五、首次安装与升级说明

> 📦 安装包由 GitHub Actions 构建（推送 `v*` tag 自动产出 x64 + arm64 全部产物）：从 Actions → Artifacts 下载 `meeting-docker-<arch>-<ver>-<rel>`，解压后即为本文的 `dist/docker/` 目录内容；也可在**同架构构建机**上执行 `npm run pack:docker` 自行打包。

### 5.1 首次安装（汇总）

```bash
# 1) 加载全部镜像
bash load-images.sh

# 2) 配置环境
cp .env.example .env
vi .env                      # 必改：MEDIASOUP_ANNOUNCED_IP=服务器IP；数据库密码等

# 3) 生成证书（可选，信创环境推荐 CA 模式）
bash deploy/docker/gen-selfsigned.sh --ca <服务器IP>

# 4) 启动（默认 SQLite + 自动初始化迁移与管理员）
docker-compose up -d

# 5) 验证
docker-compose ps
curl -k https://127.0.0.1/api/healthz
```

### 5.2 升级（汇总）

```bash
# 0) 备份（推荐）
cp .env .env.bak
docker run --rm -v meeting-data:/data -v $(pwd)/backup:/backup alpine \
  cp -a /data /backup/meeting-data-$(date +%Y%m%d)

# 1) 获取新镜像包（构建机重新打包或从 Actions 下载）
#    scp dist/docker/meeting-app-*.tar dist/docker/meeting-base-*.tar user@target:/tmp/

# 2) 加载新镜像（自动覆盖同名旧镜像）
bash load-images.sh

# 3) 启动（自动迁移）
docker-compose up -d
```

> `docker-compose up -d` 会自动用新镜像重建容器。`.env` 和数据卷保持不变，api 容器启动时**自动执行迁移与 seed**，无需手工操作。

### 5.3 升级后验收

- [ ] `curl -k https://<IP>/api/healthz` 返回 `{"ok":true}`
- [ ] `admin` 可登录；快速会议可入会
- [ ] 预约会议提交后进入待审批，`authadmin` 审批通过可发起
- [ ] 屏幕共享全屏无无限嵌套；「沉浸模式」可用
- [ ] 音视频、聊天、主持人管控正常
- [ ] 浏览器控制台无 502 / ws 错误；PWA 缓存已更新

## 六、卸载说明

```bash
# 1. 停止并删除容器
docker-compose down
# 清数据卷（谨慎）
docker-compose down -v

# 2. 删除已加载的镜像
docker rmi meeting-app:latest meeting-base:latest

# 3. 清理构建缓存（可选）
docker builder prune -f
```