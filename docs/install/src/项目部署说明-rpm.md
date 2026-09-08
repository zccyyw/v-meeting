# 项目部署说明 - RPM 包

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
| 操作系统 | Linux（RPM 系） | 中科方德、银河麒麟 V10、CentOS 7+、RHEL 等 RPM 系国产操作系统 |
| CPU 架构 | x86_64 或 aarch64（鲲鹏/飞腾/海光） | 构建机与目标机必须相同 CPU 架构；mediasoup 原生模块不可跨架构 |
| Node.js | 无需预装 | RPM 内嵌 Node.js 20 运行时到 /opt/meeting/runtime/bin/node |
| Redis | 无需预装 | 默认使用进程内内存存储（REDIS_HOST=memory），单节点零依赖 |
| 数据库 | 无需预装 | 默认 SQLite，数据文件在 /opt/meeting/data/meeting.sqlite |
| 构建机 | 任意系统 + Docker | 需联网，通过 Docker 编译原生模块并打包 RPM |

**特点说明**

- 内嵌 Node.js 运行时，目标机无需预装 Node.js
- 默认 SQLite + 内存 Redis，零外部依赖，开箱即用
- 不依赖任何 .sh 脚本，所有操作通过 node xxx.mjs 或 systemctl 完成
- 适合中科方德等安全策略禁止执行 .sh 脚本的国产操作系统
- systemd ExecStartPre 自动执行数据库迁移，无需手动操作
- 支持 rpm -ivh / rpm -Uvh / rpm -e 企业级包管理

## 三、安装说明

### 步骤 1 — 构建 RPM 包（构建机，需 Docker）

构建机要求：安装 Docker，可联网（下载 Node.js 二进制 + npm 依赖）。

```bash
cd /path/to/meeting
npm run pack:rpm
# 产物：dist/rpm/meeting-0.1-1.el7.x86_64.rpm
# ARM64（鲲鹏、飞腾）构建：
TARGET_ARCH=arm64 npm run pack:rpm
# 产物：dist/rpm/meeting-0.1-1.el7.aarch64.rpm
# 自定义版本号：
RPM_VERSION=0.2 RPM_RELEASE=1 npm run pack:rpm
```

### 步骤 2 — 目标机安装

> 安装 RPM 不需要预装 Node.js、Redis、MySQL，RPM 内嵌 Node.js 且默认使用 SQLite + 内存 Redis。

```bash
sudo rpm -ivh meeting-0.1-1.el9.x86_64.rpm
```

RPM 安装时自动完成：

1. 创建系统用户 meeting
2. 部署文件到 /opt/meeting/
3. 安装 systemd 单元到 /usr/lib/systemd/system/
4. 创建 data/、logs/、certs/ 目录
5. 设置目录属主为 meeting 用户
6. 执行 systemctl daemon-reload

### 步骤 3 — 配置

**方式一：交互式配置（推荐）**

```bash
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs
```

交互式引导完成：数据库选择 → Redis 配置 → WebRTC IP → 端口 → 证书生成 → 数据库迁移 → 种子管理员 → 启动服务。

**方式二：手动配置**

```bash
sudo cp /opt/meeting/conf/env.example /opt/meeting/conf/.env
sudo vi /opt/meeting/conf/.env
```

必改项：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| MEDIASOUP_ANNOUNCED_IP | 10.0.0.10 | 客户端可达的服务器 IP，切勿用 127.0.0.1 |
| DB_DRIVER | sqlite | 数据库类型：sqlite（默认）/ mysql / postgres |
| REDIS_HOST | memory | Redis：memory（默认，单节点零依赖）/ 127.0.0.1 |

数据库切换（可选）：

```bash
# MySQL
DB_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=meeting
MYSQL_PASSWORD=meetingpass
MYSQL_DATABASE=meeting

# PostgreSQL
DB_DRIVER=postgres
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=meeting
PGPASSWORD=meetingpass
PGDATABASE=meeting
```

### 步骤 4 — 生成证书（可选，纯 JS 不依赖 OpenSSL）

```bash
# 自签证书（内网测试）
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs <服务器IP>
# 产物：/opt/meeting/certs/fullchain.pem、privkey.pem

# CA 签发证书（信创环境推荐）
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs --ca <服务器IP>
# 产物：/opt/meeting/certs/ca.crt（导入信任库）、fullchain.pem、privkey.pem
```

> 生成证书后 gateway.mjs 自动启用 HTTPS。未生成证书时 gateway 以 HTTP 模式运行。信创环境使用 --ca 参数，并将 ca.crt 导入客户端浏览器/系统根信任机构。

### 步骤 5 — 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway
```

> meeting-api.service 配置了 ExecStartPre 和 ExecStartPost，服务启动前会自动执行数据库迁移和种子管理员，无需手动操作。

### 步骤 6 — 访问验证

| 项 | 地址 |
| --- | --- |
| 浏览器入口 | https://<服务器IP>:8088/（有证书）或 http://<服务器IP>:8088/（无证书） |
| API 健康检查 | curl -k https://127.0.0.1:8088/api/healthz |
| 默认账号 | admin / admin123（超级管理员）；另有三员账号见下方说明 |

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

> 生产环境部署后请立即修改所有默认密码。三员分立：系统管理员管用户但不能审批；授权管理员审批但不能直接操作用户；审计管理员仅查看日志。

## 五、升级说明

> 📦 安装包由 GitHub Actions 构建（推送 `v*` tag 自动产出 x64 + arm64 全部产物），从 Actions → Artifacts 下载 `meeting-rpm-<arch>-<ver>-<rel>` 即可，无需本地构建。

### 5.1 首次安装（汇总）

```bash
# 1) 安装
sudo rpm -ivh meeting-0.0.8-1.x86_64.rpm          # arm64 用 aarch64.rpm

# 2) 配置（交互式推荐，或手动 cp env.example 改 .env）
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs

# 3) 启动（ExecStartPre 自动执行数据库迁移与种子管理员）
sudo systemctl daemon-reload
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway

# 4) 验证
curl -k https://127.0.0.1:8088/api/healthz
```

### 5.2 升级（汇总）

```bash
# 0) 备份（必做）
sudo cp /opt/meeting/conf/.env /opt/meeting/conf/.env.bak
sudo cp /opt/meeting/data/meeting.sqlite ./meeting-$(date +%F).sqlite   # SQLite 场景

# 1) 直接升级安装（保留 .env 配置和数据，自动迁移）
sudo rpm -Uvh meeting-0.0.9-1.x86_64.rpm

# 2) 重启服务
sudo systemctl restart meeting-api meeting-realtime meeting-gateway
```

> `rpm -Uvh` 会保留 `/opt/meeting/conf/.env`、`/opt/meeting/data/`、`/opt/meeting/certs/` 不被覆盖。API 服务重启时 `ExecStartPre` 会自动执行数据库迁移，**无需手工执行迁移脚本**。

### 5.3 升级后验收

- [ ] `curl -k https://<IP>:8088/api/healthz` 返回 `{"ok":true}`
- [ ] `admin` 可登录；快速会议可入会
- [ ] 预约会议可提交申请，`authadmin` 审批通过后可发起会议
- [ ] 屏幕共享全屏无无限嵌套（共享者本地不显示自己的共享预览）
- [ ] 音视频、聊天、主持人管控正常
- [ ] 日志：`tail -f /opt/meeting/logs/api.log`（标准输出与错误合并到同一文件）

## 六、卸载说明

```bash
# 卸载（RPM 自动停止服务、删除文件和 systemd 单元）
sudo rpm -e meeting
# 如需彻底清理数据（谨慎）
sudo rm -rf /opt/meeting/data /opt/meeting/logs
```