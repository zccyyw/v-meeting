# 项目部署说明文档
# 离线 Docker 镜像部署

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
| CPU 架构 | x86_64（海光/兆芯）或 aarch64（鲲鹏/飞腾） | 镜像架构必须与目标机 CPU 一致；构建机也必须为同架构 |
| Docker | 20 及以上 | 目标机仅需 docker load 与 docker-compose up，无需外网 |
| Docker Compose | v2.20+ | 使用 include 指令 |
| Node.js / 数据库 / Redis | 无需安装 | 全部内置在离线镜像中 |

离线包由 GitHub Actions 自动构建（或同架构构建机执行 npm run pack:docker 产出），拷贝到目标机加载即可，全程无需访问 npm 网络。

## 三、开放端口

| 端口 | 协议 | 用途 | 说明 |
| --- | --- | --- | --- |
| 80 / 443 | TCP | Web 访问入口（Caddy 反向代理，自动 HTTPS） | 浏览器访问入口 |
| 40000-41000 | UDP | WebRTC 音视频媒体 | 防火墙/安全组必须单独放行 |
| 8080 / 8081 / 8082 | TCP | API / Web / 信令（容器内部端口） | 经 Caddy 反代，无需对外放行 |
| 3306 / 5432 / 6379 | TCP | 数据库 / Redis（容器内部端口） | 无需对外放行 |

注意：WebRTC 音视频走 UDP 40000-41000，与 Web 访问的 TCP 端口是两套独立通路。云平台通常默认只放行 80/443，必须单独放行该 UDP 段入方向，否则会议能进入但看不到对方画面、听不到声音。

连通性验证：部署后在浏览器打开会议页面，服务器上抓包确认 UDP 媒体流到达：

```bash
sudo tcpdump -i any -n 'udp and portrange 40000-41000'
```

## 四、安装说明

### 步骤 1：上传并解压安装包

已获取到离线包 zip（meeting-docker-x64-*.zip 或 meeting-docker-arm64-*.zip，架构必须与目标机 CPU 一致），手动上传到服务器并解压：

```bash
scp meeting-docker-*.zip user@<目标机IP>:/opt/meeting-offline/
```

```bash
cd /opt/meeting-offline
unzip meeting-docker-*.zip -d meeting-docker
cd meeting-docker
```

### 步骤 2：脚本授权并确认文件完整

为脚本添加执行权限：

```bash
chmod +x load-images.sh
chmod +x deploy/docker/gen-selfsigned.sh
```

确认目录内容完整：

```bash
ls -la
```

应包含：meeting-app-*.tar（应用镜像）、meeting-base-*.tar（基础镜像）、docker-compose.yml、Caddyfile、env.example（环境配置模板）、load-images.sh（镜像加载脚本）、deploy/docker/gen-selfsigned.sh（证书生成脚本）。

### 步骤 3：加载镜像

```bash
bash load-images.sh
```

脚本自动加载目录内全部镜像 tar（应用镜像与 PostgreSQL/MySQL/Redis/Caddy 基础镜像）。加载完成可执行 docker images 确认。

### 步骤 4：配置环境

提示：离线包内的 `env.example` 即仓库 `.env.production.example` 的拷贝；本地开发用 `.env.example`，主机部署用 `deploy/native/conf/env.example`，三者不可混用。

```bash
cp env.example .env
vi .env
```

必改项：

| 变量 | 说明 |
| --- | --- |
| MEDIASOUP_ANNOUNCED_IP | 客户端可达的服务器 IP，切勿填 127.0.0.1 |
| COMPOSE_PROFILES | 数据库类型：sqlite（默认，零依赖）/ postgres / mysql |
| 数据库密码类变量 | 使用 postgres / mysql profile 时必须修改默认密码 |

### 步骤 5：生成证书

```bash
bash deploy/docker/gen-selfsigned.sh --ca <服务器IP或域名>
```

以 CA 签发模式生成根证书与服务器证书（信创环境必须），并将 ca.crt 导入客户端浏览器/系统信任机构。

### 步骤 6：启动与验证

```bash
docker-compose up -d
```

首次启动时 api 容器自动执行数据库迁移并写入默认账号。查看容器运行状态：

```bash
docker-compose ps
```

浏览器打开 https://<服务器IP>/，或执行健康检查：

```bash
curl -k https://127.0.0.1/api/healthz
```

下载CA文件
```bash
安装目录deploy/docker/certs/ca.crt
```

## 五、升级说明

升级前备份（必做）：备份 .env 与数据卷（SQLite 数据文件或数据库 dump）。

升级步骤（构建机产出新离线包后）：

```bash
# 1. 新离线包拷贝到目标机
# 2. 加载新镜像
cd <新离线包目录>
bash load-images.sh
# 3. 重启服务（沿用原目录的 .env，数据卷保留）
cd <原部署目录>
docker-compose up -d
```

docker-compose up -d 自动用新镜像重建容器，.env 与数据卷保持不变，api 容器启动时自动执行数据库迁移。数据库迁移通常不可逆，回滚请优先使用备份恢复。

升级后检查：健康检查返回正常、admin 可登录、创建快速会议可入会、预约会议提交后可审批并可发起、双人流媒体音视频正常、群组置顶正常；如页面样式异常，清浏览器缓存强制刷新（PWA 缓存更新）。

## 六、卸载说明

```bash
cd <部署目录>
docker-compose down
```

以上保留数据卷。彻底清理（含数据库与录制数据，谨慎）：

```bash
docker-compose down -v
```

删除已加载的镜像：

```bash
docker images | grep meeting
docker rmi meeting-app:latest meeting-base:latest
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

- 架构一致性：镜像架构（x86_64/aarch64）必须与目标机 CPU 一致，构建机也须同架构。
- Docker 版本：麒麟/UOS 软件源的 docker.io 版本较旧，建议使用官方静态二进制安装 Docker 20+ 与 Compose v2。
- npm 私服：构建机连淘宝 npm 镜像也不可达时，可在项目根放置 .npmrc 指向内网私服，或直接使用 CI 产物。
- SELinux：如开启 enforcing 模式，需按系统策略放行容器端口映射。
- 客户端浏览器：推荐奇安信浏览器（涉密版）、UOS 浏览器或 Chrome 100+。
- 会议无声音/无画面：绝大多数为 UDP 40000-41000 未放行，见"三、开放端口"抓包排查；同时确认 MEDIASOUP_ANNOUNCED_IP 为客户端可达 IP。
- PWA 缓存：升级后如页面异常，请清除浏览器缓存或强制刷新。
