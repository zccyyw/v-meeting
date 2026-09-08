# 项目部署说明 - Docker Compose

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
| 操作系统 | Linux / Windows Server | 推荐 CentOS 7+、Ubuntu 20.04+、Debian 11+；需安装 Docker 20+ 与 Compose v2.20+ |
| CPU 架构 | x86_64 或 aarch64 | 与构建环境一致即可；mediasoup 在容器内编译，无跨架构限制 |
| Docker | 20+ + Compose v2.20+ | 需支持 include 指令；docker-compose version 查看 |
| 网络 | 需联网（在线构建）或可离线（离线安装） | 在线构建需拉取 npm 依赖与 Docker 基础镜像；离线安装仅需加载预构建镜像 |

## 三、服务器端口要求

服务器需开放以下端口：

| 协议 | 端口 | 说明 |
| --- | --- | --- |
| TCP | 80 | HTTP 入口（Caddy 自动重定向到 443） |
| TCP | 443 | HTTPS 入口（WebRTC 信令、API、前端） |
| UDP | 40000-41000 | mediasoup RTP 端口范围（音视频媒体流） |

## 四、安装说明

### 方式 A：离线安装（预构建镜像）

适用于服务器无外网或需快速部署的场景。

**步骤 1 — 上传安装包**

将 meeting-docker-v0.1-xxx.zip 上传到服务器。

**步骤 2 — 解压**

```bash
unzip meeting-docker-v0.1-xxx.zip
```

**步骤 3 — 脚本授权**

```bash
chmod +x load-images.sh
chmod +x deploy/docker/gen-selfsigned.sh
```

**步骤 4 — 加载全部镜像**

```bash
bash load-images.sh
```

**步骤 5 — 配置环境**

```bash
cp .env.example .env
vi .env
# 改 MEDIASOUP_ANNOUNCED_IP=当前服务器访问IP
```

必改项：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| COMPOSE_PROFILES | sqlite / postgres / mysql | 决定数据库类型，默认 sqlite（零依赖） |
| MEDIASOUP_ANNOUNCED_IP | 10.0.0.10 | 客户端可达的公网/局域网 IP，切勿用 127.0.0.1 |
| MEDIASOUP_LISTEN_IP | 0.0.0.0 | 监听地址 |
| VITE_API_BASE | /api | 前端调 API 的路径（经 Caddy 反代） |
| VITE_WS_URL | auto | WebSocket 地址，auto 表示同源 wss |

**步骤 6 — 生成证书**

```bash
# 自签证书（内网测试）
bash deploy/docker/gen-selfsigned.sh <服务器IP>
# 产物：deploy/docker/certs/fullchain.pem、privkey.pem

# CA 签发证书（信创环境推荐）
bash deploy/docker/gen-selfsigned.sh --ca <服务器IP>
# 产物：ca.crt（导入信任库）、fullchain.pem、privkey.pem
```

> 生产环境请替换为正式证书（放入 deploy/docker/certs/）。信创环境使用 --ca 参数，并将 ca.crt 导入客户端浏览器/系统根信任机构。

**步骤 7 — 启动**

```bash
docker-compose up -d
```

### 方式 B：在线构建

适用于服务器可联网的场景。

**步骤 1 — 准备环境文件**

```bash
cp .env.production.example .env
vi .env
```

必改项同方式 A 步骤 5。

**步骤 2 — 生成证书（可选）**

```bash
# 自签证书
bash deploy/docker/gen-selfsigned.sh <你的服务器IP或域名>
# 或 CA 签发证书（信创环境推荐）
bash deploy/docker/gen-selfsigned.sh --ca <你的服务器IP>
```

> 生产环境请替换为正式证书（放入 deploy/docker/certs/）。

**步骤 3 — 构建并启动**

```bash
docker-compose up -d
```

> api 容器启动时会自动执行数据库迁移并写入默认管理员 admin/admin123（migrate 与 seed 均幂等，可重复执行）。

## 五、访问验证

| 项 | 地址 |
| --- | --- |
| 浏览器入口 | https://<服务器IP>/ |
| 默认账号 | admin / admin123（超级管理员）；另有三员账号见下方说明 |
| 健康检查 | curl -k https://127.0.0.1/api/healthz |

## 六、默认账号说明

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

## 七、首次安装与升级说明

> 📦 安装包由 GitHub Actions 构建（推送 `v*` tag 自动产出 x64 + arm64 全部产物），从 Actions → Artifacts 下载对应产物即可。

### 7.1 首次安装（汇总）

- **在线构建**：`cp .env.production.example .env` → 改 `MEDIASOUP_ANNOUNCED_IP` → `docker-compose up -d --build`
- **离线镜像**：`bash load-images.sh` → `cp .env.example .env` → `docker-compose up -d`

详细步骤见本文 [四、安装说明](#四安装说明)。首次启动 api 容器会自动执行数据库迁移并写入默认管理员。

### 7.2 升级（离线部署）

**步骤 1 — 停止当前服务**

```bash
docker-compose down
```

**步骤 2 — 备份数据（可选但推荐）**

```bash
docker run --rm -v meeting-data:/data -v $(pwd)/backup:/backup alpine \
cp -a /data /backup/meeting-data-$(date +%Y%m%d)
```

**步骤 3 — 上传新版本安装包**

```bash
unzip -o meeting-docker-v0.x-xxx.zip
```

**步骤 4 — 加载新镜像**

```bash
bash load-images.sh
```

> load-images.sh 会自动覆盖同名旧镜像，无需手动删除。

**步骤 5 — 启动（自动迁移）**

```bash
docker-compose up -d
```

**步骤 6 — 验证**

```bash
docker-compose ps
curl -k https://127.0.0.1/api/healthz
```

## 八、停止与清理

```bash
# 停止服务（保留数据卷）
docker-compose down
# 彻底清理（含数据卷，谨慎）
docker-compose down -v
```

## 九、移除镜像

```bash
docker images | grep meeting
docker rmi meeting-app:latest meeting-base:latest
# 清理所有未使用的镜像（谨慎）
docker image prune -f
```

## 附录：Docker 与 Docker-Compose 常用命令

### Docker 常用命令

| 命令 | 说明 |
| --- | --- |
| docker version | 查看 Docker 版本 |
| docker info | 查看 Docker 系统信息 |
| docker images | 列出本地所有镜像 |
| docker ps | 查看运行中的容器 |
| docker ps -a | 查看所有容器（含已停止） |
| docker logs <容器名> | 查看容器日志 |
| docker logs -f <容器名> | 实时跟踪容器日志 |
| docker exec -it <容器名> sh | 进入容器终端 |
| docker stats | 查看容器资源占用 |
| docker stop <容器名> | 停止容器 |
| docker start <容器名> | 启动已停止的容器 |
| docker restart <容器名> | 重启容器 |
| docker rm <容器名> | 删除已停止的容器 |
| docker rmi <镜像名> | 删除镜像 |
| docker load -i <file.tar> | 从 tar 文件加载镜像 |

### Docker-Compose 常用命令

| 命令 | 说明 |
| --- | --- |
| docker-compose version | 查看 Compose 版本 |
| docker-compose up -d | 后台构建并启动所有服务 |
| docker-compose up -d --build | 强制重新构建镜像后启动 |
| docker-compose down | 停止并删除容器（保留数据卷） |
| docker-compose down -v | 停止并删除容器和数据卷（谨慎） |
| docker-compose ps | 查看服务状态 |
| docker-compose logs | 查看所有服务日志 |
| docker-compose logs -f <服务名> | 实时跟踪指定服务日志 |
| docker-compose restart <服务名> | 重启指定服务 |
| docker-compose exec <服务名> sh | 进入指定服务容器终端 |
| docker-compose config | 检查并显示合并后的 compose 配置 |
| docker-compose stop | 停止服务（不删除容器） |
| docker-compose start | 启动已停止的服务 |