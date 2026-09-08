# 项目部署说明 - 离线发布包（tar.gz）

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
| 操作系统 | Linux | 银河麒麟 V10、统信 UOS、中科方德、CentOS、Ubuntu 等 |
| CPU 架构 | x86_64 或 aarch64（鲲鹏/飞腾/海光） | 构建机与目标机必须相同 CPU 架构；mediasoup 原生模块不可跨架构 |
| Node.js | 20+（在 PATH 中） | 目标机需预装 |
| Redis | 7.x | 目标机需预装；或使用 MySQL/PG 时需预装对应数据库 |
| 数据库 | SQLite（默认）/ MySQL 8 / PostgreSQL 12+ | 三选一 |
| 构建机 | 同架构 Linux + Node.js 20+ | 需联网，可访问 npm |

## 三、安装说明

### 步骤 1 — 构建离线包（构建机，需联网）

构建机要求：与目标机相同 CPU 架构的 Linux（mediasoup 原生模块不可跨架构），Node.js 20+，可访问 npm。

```bash
cd /path/to/meeting
npm install
npm run pack:native
# 产物：dist/native/meeting-linux-arm64-YYYYMMDD.tar.gz（或 x64）
```

### 步骤 2 — 目标机准备

| 组件 | 要求 |
| --- | --- |
| Node.js | 20+（在 PATH 中） |
| Redis | 7.x |
| 数据库 | SQLite（默认，零依赖）/ MySQL 8 / PostgreSQL 12+ |

建库示例（MySQL）：

```sql
CREATE DATABASE IF NOT EXISTS meeting DEFAULT CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'meeting'@'%' IDENTIFIED BY 'meetingpass';
GRANT ALL PRIVILEGES ON meeting.* TO 'meeting'@'%';
FLUSH PRIVILEGES;
```

建库示例（PostgreSQL）：

```sql
CREATE USER meeting WITH PASSWORD 'meetingpass';
CREATE DATABASE meeting OWNER meeting;
```

### 步骤 3 — 安装

```bash
# 解压
tar -xzf meeting-linux-arm64-YYYYMMDD.tar.gz
cd meeting-linux-arm64-YYYYMMDD
# root 执行安装
sudo ./install.sh
```

install.sh 会自动完成以下操作：

1. 校验架构（与 ARCH.txt 比对）与 Node 版本
2. 创建系统用户 meeting
3. 部署到 /opt/meeting（可用 MEETING_PREFIX 改）
4. 生成 /opt/meeting/conf/.env
5. 安装 systemd 单元：meeting-api / meeting-realtime / meeting-gateway
6. 执行 migrate + seed
7. enable --now 三个服务

常用安装环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| MEETING_PREFIX | /opt/meeting | 安装目录 |
| MEETING_USER | meeting | 运行用户 |
| MEETING_SKIP_SEED | 0 | 设为 1 跳过写入 admin |

### 步骤 4 — 修改配置

```bash
sudo vi /opt/meeting/conf/.env
```

必改项：

- MEDIASOUP_ANNOUNCED_IP：客户端能访问的服务器 IP（局域网勿填 127.0.0.1）
- 数据库 / Redis 账号密码
- DB_DRIVER=mysql 或 postgres

改完后重启：

```bash
sudo systemctl restart meeting-api meeting-realtime meeting-gateway
```

### 步骤 5 — 访问验证

| 项 | 地址 |
| --- | --- |
| 浏览器入口 | http://<服务器IP>:8088/（GATEWAY_PORT） |
| API 健康检查 | curl http://127.0.0.1:8088/api/healthz |
| 默认账号 | admin / admin123（超级管理员）；另有三员账号见下方说明 |

### 步骤 6 — HTTPS 证书配置（可选）

**方式 A — 使用内置 genssl.sh（信创环境推荐）**

```bash
# 生成 CA 根证书 + 服务器 IP 证书（默认输出到 /opt/meeting/certs）
sudo /opt/meeting/bin/genssl.sh <服务器IP>
# 示例：sudo /opt/meeting/bin/genssl.sh 192.168.1.100
# 将 ca.crt 复制到各信创客户端，导入浏览器/系统根信任机构
```

**方式 B — 使用已有证书**

```bash
sudo mkdir -p /opt/meeting/certs
# 放入 fullchain.pem / privkey.pem
```

配置 Nginx HTTPS：

```bash
sudo systemctl disable --now meeting-gateway
sudo cp /opt/meeting/conf/nginx-meeting-ssl.conf /etc/nginx/conf.d/meeting-ssl.conf
sudo nginx -t && sudo systemctl reload nginx
```

配置 gateway HTTPS：编辑 /opt/meeting/conf/.env，设置 GATEWAY_TLS_CERT 和 GATEWAY_TLS_KEY，然后 sudo systemctl restart meeting-gateway。

> 信创环境（麒麟/UOS/中科方德）浏览器不允许直接信任自签名证书，必须使用 genssl.sh 生成 CA 根证书并导入客户端信任库。

## 四、默认账号说明

系统初始化时自动创建以下账号：

| 账号 | 密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| admin | admin123 | 超级管理员 | 全部权限 |
| system | system123 | 超级管理员 | 隐藏系统用户 |
| sysadmin | Admin@123 | 系统管理员 | 首次登录提示修改密码 |
| authadmin | Admin@123 | 授权管理员 | 首次登录提示修改密码 |
| auditadmin | Admin@123 | 审计管理员 | 首次登录提示修改密码 |
| meeting | Admin@123 | 普通用户 | 首次登录提示修改密码 |
| test1-test5 | 123456 | 普通用户 | 测试用户 |

> 生产环境部署后请立即修改所有默认密码。三员分立：系统管理员管用户但不能审批；授权管理员审批但不能直接操作用户；审计管理员仅查看日志。

## 五、升级说明

> 📦 安装包由 GitHub Actions 构建（推送 `v*` tag 自动产出 x64 + arm64 全部产物），从 Actions → Artifacts 下载 `meeting-native-<arch>-<ver>-<rel>` 即可；也可在**同架构 Linux 构建机**上执行 `npm run pack:native` 自行打包。

### 5.1 首次安装（汇总）

```bash
# 1) 解压
tar -xzf meeting-linux-arm64-YYYYMMDD.tar.gz
cd meeting-linux-arm64-YYYYMMDD

# 2) 安装（创建 meeting 用户、部署 /opt/meeting、安装 systemd 单元、迁移+种子、启动服务）
sudo ./install.sh

# 3) 修改配置
sudo vi /opt/meeting/conf/.env        # 至少改 MEDIASOUP_ANNOUNCED_IP 为服务器 IP
sudo systemctl restart meeting-api meeting-realtime meeting-gateway

# 4) 验证
curl http://127.0.0.1:8088/api/healthz
# 浏览器访问 http://<服务器IP>:8088/
```

### 5.2 升级（汇总）

```bash
# 0) 备份（必做）
sudo cp /opt/meeting/conf/.env /opt/meeting/conf/.env.bak

# 1) 获取新包（构建机打包或从 Actions 下载）
# 2) 目标机解压新包
tar -xzf meeting-linux-arm64-NEWDATE.tar.gz
cd meeting-linux-arm64-NEWDATE

# 3) 重新安装（保留已有 .env，自动 migrate）
sudo ./install.sh
```

> `install.sh` 会保留 `/opt/meeting/conf/.env`，覆盖 `app/` 并重新执行 migrate，**无需手工跑迁移**。

### 5.3 升级后验收

- [ ] `curl http://<IP>:8088/api/healthz` 返回 `{"ok":true}`
- [ ] `admin` 可登录；快速会议可入会
- [ ] 预约会议走审批流（`authadmin` 审批后可发起）
- [ ] 屏幕共享全屏无无限嵌套；「沉浸模式」可用
- [ ] 音视频、聊天、主持人管控正常
- [ ] 日志：`tail -f /opt/meeting/logs/*.log`（标准输出与错误合并到同一文件）

## 六、卸载说明

```bash
sudo systemctl disable --now meeting-api meeting-realtime meeting-gateway
sudo rm -f /etc/systemd/system/meeting-*.service
sudo systemctl daemon-reload
sudo rm -rf /opt/meeting
# 数据库与 Redis 数据需自行决定是否删除
```
