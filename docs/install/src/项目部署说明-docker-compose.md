# 项目部署说明文档
# Docker Compose 部署

## 一、服务器配置

| 配置项 | 最低配置 | 推荐配置 | 说明 |
| --- | --- | --- | --- |
| CPU | 4 核 | 8 核以上 | mediasoup 音视频转发需要一定算力 |
| 内存 | 8 GB | 16 GB 以上 | 含数据库、Redis 容器的整体内存占用 |
| 磁盘 | 100 GB | 200 GB 以上 | 系统 + 镜像 + 数据卷 + 录制文件存储 |
| 网络 | 百兆 | 千兆以上 | WebRTC 音视频对带宽和延迟敏感 |

以上为 50 人以下并发会议的合理基线，更多并发请按线性增长评估。

## 二、操作系统与架构要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Linux（含银河麒麟 V10、统信 UOS、中科方德等国产系统） | 容器内自带运行时与 glibc，与宿主系统版本解耦，麒麟 V10 SP1 亦可运行 |
| CPU 架构 | x86_64（海光/兆芯）或 aarch64（鲲鹏/飞腾） | 镜像架构必须与目标机 CPU 一致 |
| Docker | 20 及以上 | 需 Docker Compose v2.20+（使用 include 指令），docker-compose version 可查版本 |
| Node.js | 无需安装 | 运行时在容器内 |
| 数据库 | 容器编排内置 | 由 COMPOSE_PROFILES 选择 SQLite（默认，零外部容器）/ MySQL 8 / PostgreSQL 12+ |
| Redis | 容器编排内置 | 无需宿主机安装 |

## 三、开放端口

| 端口 | 协议 | 用途 | 说明 |
| --- | --- | --- | --- |
| 80 / 443 | TCP | Web 访问入口（Caddy 反向代理，自动 HTTPS） | 浏览器访问入口 |
| 40000-41000 | UDP | WebRTC 音视频媒体 | 防火墙/安全组必须单独放行 |
| 8080 / 8081 / 8082 | TCP | API / Web / 信令（容器内部端口） | 经 Caddy 反代，无需对外放行 |
| 3306 / 5432 / 6379 | TCP | 数据库 / Redis（容器内部端口） | 无需对外放行 |

注意：WebRTC 音视频走 UDP 40000-41000，与 Web 访问的 TCP 端口是两套独立通路。云平台通常默认只放行 80/443，必须单独放行该 UDP 段入方向，否则会议能进入但看不到对方画面、听不到声音。

放行示例（firewalld）：

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=40000-41000/udp
sudo firewall-cmd --reload
```

连通性验证：部署后在浏览器打开会议页面，服务器上抓包确认 UDP 媒体流到达：

```bash
sudo tcpdump -i any -n 'udp and portrange 40000-41000'
```

## 四、安装说明

### 步骤 1：获取源码到服务器

将项目源码（含 docker-compose.yml、各服务 Dockerfile、deploy/docker/ 等）上传到目标机：

```bash
# 方式一：git 拉取（服务器可访问代码仓库时）
git clone <仓库地址> meeting
cd meeting

# 方式二：本地打包后手动上传到服务器（内网环境），再解压
mkdir -p /opt/meeting && tar -xzf meeting-src.tar.gz -C /opt/meeting && cd /opt/meeting
```

### 步骤 2：准备环境文件

提示：本项目根目录有三份环境模板，用途不同、不可混用——本方式使用 `.env.production.example`；本地开发用 `.env.example`；RPM/DEB/离线发布包主机部署用 `deploy/native/conf/env.example`。

```bash
cp .env.production.example .env
vi .env
```

必改项：

| 变量 | 说明 |
| --- | --- |
| COMPOSE_PROFILES | 数据库类型：sqlite（默认，零依赖）/ postgres / mysql |
| MEDIASOUP_ANNOUNCED_IP | 客户端可达的服务器 IP，切勿填 127.0.0.1 |
| MEDIASOUP_LISTEN_IP | 监听地址，默认 0.0.0.0 |
| 数据库密码类变量 | 使用 postgres / mysql profile 时必须修改默认密码 |

### 步骤 3：生成证书

```bash
bash deploy/docker/gen-selfsigned.sh --ca <服务器IP或域名>
```

以 CA 签发模式生成根证书与服务器证书（信创环境必须），并将 ca.crt 导入客户端浏览器/系统信任机构。

证书生成后，客户端可直接在登录页点击「下载 CA 根证书」获取 ca.crt（接口：/api/certs/ca.crt），也可从服务器 deploy/docker/certs/ca.crt 拷贝。生产环境建议替换为正式证书放入 deploy/docker/certs/。

### 步骤 4：构建并启动

```bash
docker-compose up -d --build
```

首次启动时 api 容器自动执行数据库迁移并写入默认账号（迁移与账号写入均幂等，可重复执行）。

### 步骤 5：访问验证

| 项 | 地址 |
| --- | --- |
| 浏览器入口 | https://<服务器IP>/ |
| 健康检查 | curl -k https://127.0.0.1/api/healthz |

## 五、升级说明

升级前备份（必做）：

```bash
cp .env .env.bak
docker-compose exec postgres pg_dump -U postgres meeting > backup-$(date +%F).sql
```

（SQLite 模式请直接备份对应数据文件/数据卷。）

执行升级：

```bash
git pull
docker-compose up -d --build
```

升级保留 .env 与数据卷；api 容器启动时自动执行数据库迁移与默认账号写入，无需手动操作。数据库迁移通常不可逆，回滚请优先使用备份恢复。

升级后检查：健康检查返回正常、admin 可登录、创建快速会议可入会、预约会议提交后可审批并可发起、双人流媒体音视频正常、群组置顶正常；如页面样式异常，清浏览器缓存强制刷新（PWA 缓存更新）。

## 六、卸载说明

```bash
docker-compose down
```

以上保留数据卷。彻底清理（含数据库与录制数据，谨慎）：

```bash
docker-compose down -v
```

## 七、默认账号

| 账号 | 初始密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| admin | admin123 | 超级管理员 | 全部权限 |
| sysadmin | Admin@123 | 系统管理员 | 首次登录强制修改密码 |
| authadmin | Admin@123 | 授权管理员 | 首次登录强制修改密码 |
| auditadmin | Admin@123 | 审计管理员 | 首次登录强制修改密码 |
| meeting | Admin@123 | 普通用户 | 首次登录强制修改密码 |

三员分立原则：系统管理员管理用户但不能审批会议申请；授权管理员审批但不能直接操作用户；审计管理员仅查看审计日志。

注意：生产环境部署后请立即修改全部默认密码；连续 5 次输错密码账号将锁定 60 秒。

## 八、注意事项

- 架构一致性：镜像架构（x86_64/aarch64）必须与目标机 CPU 一致。
- mediasoup 构建（国内网络/老内核）：构建时需编译 mediasoup C++ worker，Dockerfile 已内置 GitHub 代理与 pip 镜像；如默认代理不可用，可构建时换源；老内核系统（如 CentOS 7）必须本地编译，构建耗时 10-15 分钟属正常。
- Docker 版本：麒麟/UOS 软件源的 docker.io 版本较旧，建议使用官方静态二进制安装 Docker 20+ 与 Compose v2。
- SELinux：如开启 enforcing 模式，需放行 Web 端口或按系统策略配置容器端口映射。
- 客户端浏览器：推荐奇安信浏览器（涉密版）、UOS 浏览器或 Chrome 100+；前端构建目标为 ES2020，兼容较老 Chromium 内核。
- 会议无声音/无画面：绝大多数为 UDP 40000-41000 未放行，见"三、开放端口"抓包排查；同时确认 MEDIASOUP_ANNOUNCED_IP 为客户端可达 IP。
- PWA 缓存：升级后如页面异常，请清除浏览器缓存或强制刷新。
