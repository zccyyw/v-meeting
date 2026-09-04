# Meeting 离线发布包 — 安装说明

适用于 **Linux x86_64 / aarch64**（含银河麒麟、统信 UOS 等）。  
包内含：前端静态资源、API、信令/SFU（含本机构建的 mediasoup）、systemd 单元、`install.sh`、内置 HTTP 网关。

> **重要**：离线包必须在与目标机 **相同 CPU 架构的 Linux** 上执行 `npm run pack:native` 生成（mediasoup 原生模块不可跨架构）。

---

## 1. 环境准备（目标机）

| 组件 | 要求 |
|------|------|
| OS | Linux（systemd 推荐） |
| CPU | x86_64 或 aarch64，与安装包 `ARCH.txt` 一致 |
| Node.js | **20+**（`node -v`），需已装在 PATH |
| 数据库 | MySQL 8 或 PostgreSQL 12+（本机或可达地址） |
| Redis | 7.x（本机或可达地址） |
| 防火墙 | 放行 `GATEWAY_PORT`（默认 8088）、UDP `40000-40100`（WebRTC） |

建库示例（MySQL）：

```sql
CREATE DATABASE IF NOT EXISTS meeting DEFAULT CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'meeting'@'%' IDENTIFIED BY 'meetingpass';
GRANT ALL PRIVILEGES ON meeting.* TO 'meeting'@'%';
FLUSH PRIVILEGES;
```

PostgreSQL：

```sql
CREATE USER meeting WITH PASSWORD 'meetingpass';
CREATE DATABASE meeting OWNER meeting;
```

---

## 2. 构建离线包（构建机，需能访问 npm）

在 **目标同架构的 Linux** 上（麒麟 aarch64 虚机 / ARM CI）：

```bash
cd /path/to/meeting
npm install
npm run pack:native
```

产物：

```
dist/native/
  meeting-linux-arm64-YYYYMMDD.tar.gz   # 或 x64
  meeting-linux-arm64-YYYYMMDD/         # 未压缩目录（可选保留）
  README.txt
```

非 Linux 开发机默认会拒绝打包。仅调试可：

```bash
PACK_NATIVE_FORCE=1 npm run pack:native
```

（这样打出的 mediasoup 可能无法在 Linux ARM 上运行。）

将 `.tar.gz` 拷到目标机即可（**目标机安装时不需要 npm 网络**）。

---

## 3. 目标机安装步骤

```bash
# 1) 解压
tar -xzf meeting-linux-arm64-YYYYMMDD.tar.gz
cd meeting-linux-arm64-YYYYMMDD

# 2) 安装（root）
sudo ./install.sh
```

`install.sh` 会：

1. 检查架构 / Node 版本  
2. 创建系统用户 `meeting`（可用环境变量改）  
3. 部署到 `/opt/meeting`（可用 `MEETING_PREFIX` 改）  
4. 首次生成 `/opt/meeting/conf/.env`  
5. 安装 systemd：`meeting-api` / `meeting-realtime` / `meeting-gateway`  
6. 执行 `migrate` + `seed`（默认管理员）  
7. `enable --now` 三个服务  

### 常用环境变量（安装前导出）

| 变量 | 默认 | 说明 |
|------|------|------|
| `MEETING_PREFIX` | `/opt/meeting` | 安装目录 |
| `MEETING_USER` | `meeting` | 运行用户 |
| `MEETING_SKIP_SEED` | `0` | 设为 `1` 跳过写入 admin |

```bash
sudo MEETING_PREFIX=/data/meeting MEETING_SKIP_SEED=1 ./install.sh
```

---

## 4. 修改配置

编辑：

```bash
sudo vi /opt/meeting/conf/.env
```

**必改：**

- `MEDIASOUP_ANNOUNCED_IP`：客户端能访问的 IP/域名（局域网勿填错）  
- 数据库 / Redis 账号密码  
- `DB_DRIVER=mysql` 或 `postgres`

改完后：

```bash
sudo systemctl restart meeting-api meeting-realtime meeting-gateway
```

若改库结构或重装后需手工迁移/种子：

```bash
cd /opt/meeting/app/serve/api
sudo -u meeting /opt/meeting/bin/node --env-file=/opt/meeting/conf/.env dist/migrate.js
sudo -u meeting /opt/meeting/bin/node --env-file=/opt/meeting/conf/.env dist/seed-admin.js
```

---

## 5. 访问与验证

| 项 | 地址 |
|----|------|
| 浏览器入口 | `http://<服务器IP>:8088/`（`GATEWAY_PORT`） |
| API 健康检查 | `curl http://127.0.0.1:8088/api/healthz` |
| 默认账号 | `admin` / `admin123` |

```bash
curl -s http://127.0.0.1:8088/api/healthz
# {"ok":true}

sudo systemctl status meeting-api meeting-realtime meeting-gateway
sudo journalctl -u meeting-api -f
# 或日志文件：
tail -f /opt/meeting/logs/*.log
```

---

## 6. 服务管理（systemd）

```bash
sudo systemctl start|stop|restart meeting-api
sudo systemctl start|stop|restart meeting-realtime
sudo systemctl start|stop|restart meeting-gateway

sudo systemctl enable meeting-api meeting-realtime meeting-gateway
sudo systemctl disable meeting-api meeting-realtime meeting-gateway
```

无 systemd 时：

```bash
sudo -u meeting /opt/meeting/bin/start-all.sh
sudo /opt/meeting/bin/stop-all.sh
```

---

## 7. 可选：Nginx 入口与 HTTPS

完整 HTTPS 方案见仓库文档：[项目打包与部署说明.md](../../docs/项目打包与部署说明.md)（第八节 HTTPS 配置）。

**仅 HTTP（Nginx 替代 gateway）：**

```bash
sudo systemctl disable --now meeting-gateway
sudo cp /opt/meeting/conf/nginx-meeting.conf /etc/nginx/conf.d/meeting.conf
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS（推荐生产）：**

证书生成方式二选一：

**方式 A — 使用内置 genssl.sh（信创环境推荐）**

```bash
# 生成 CA 根证书 + 服务器 IP 证书（默认输出到 /opt/meeting/certs）
sudo /opt/meeting/bin/genssl.sh <服务器IP>
# 示例：sudo /opt/meeting/bin/genssl.sh 192.168.1.100

# 将 ca.crt 复制到各信创客户端，导入浏览器/系统根信任机构
# 然后使用 Nginx 或 gateway 加载证书
```

**方式 B — 使用已有证书**

```bash
sudo mkdir -p /opt/meeting/certs
# 放入 fullchain.pem / privkey.pem
```

**配置 Nginx HTTPS**

```bash
sudo systemctl disable --now meeting-gateway
sudo cp /opt/meeting/conf/nginx-meeting-ssl.conf /etc/nginx/conf.d/meeting-ssl.conf
# 修改 server_name 与证书路径
sudo nginx -t && sudo systemctl reload nginx
```

**配置 gateway HTTPS**

编辑 `/opt/meeting/conf/.env`，设置 `GATEWAY_TLS_CERT=/opt/meeting/certs/fullchain.pem` 和 `GATEWAY_TLS_KEY=/opt/meeting/certs/privkey.pem`，然后：

```bash
sudo systemctl restart meeting-gateway
```

> 信创环境（麒麟/UOS/中科方德）浏览器不允许直接信任自签名证书，必须使用 `genssl.sh` 生成 CA 根证书并导入客户端信任库。

Nginx 直连 `api:8080` / `realtime:8082` 与静态目录；前端使用相对 `/api` 与同域 `wss`（打包默认 `VITE_WS_URL=auto`）。

---

## 8. 卸载

```bash
sudo systemctl disable --now meeting-api meeting-realtime meeting-gateway
sudo rm -f /etc/systemd/system/meeting-*.service
sudo systemctl daemon-reload
sudo rm -rf /opt/meeting
# 数据库与 Redis 数据需自行决定是否删除
```

---

## 9. 目录结构（安装后）

```
/opt/meeting/
  conf/.env
  app/
    front/           # 静态资源
    serve/api|realtime|shared|db
    node_modules/
  bin/gateway.mjs
  bin/start-all.sh
  logs/
```

---

## 10. 故障排查

| 现象 | 处理 |
|------|------|
| 架构不符 | 看包内 `ARCH.txt`，换对应 tar |
| mediasoup / realtime 起不来 | 确认包在目标同架构 Linux 上构建；装 `python3 make g++` 后于构建机重打 |
| 能开页面不能音视频 | 查 `MEDIASOUP_ANNOUNCED_IP`、UDP 40000-40100 |
| DB 连接失败 | 查 `.env` 与本机库监听、防火墙 |
| 仅 API 502 | `systemctl status meeting-api`，看 `/opt/meeting/logs/api.err.log` |
