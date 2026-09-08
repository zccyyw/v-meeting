# 项目部署说明 - DEB 包

适用于 **统信 UOS、中科方德（DEB 系）、Debian / Ubuntu** 等 DEB 系操作系统。

**核心特性**：内嵌 Node.js 运行时（目标机无需预装）、默认 SQLite + 内存 Redis（零外部依赖）、systemd 托管、`gateway.mjs` 内置 HTTPS、**不依赖任何 .sh 脚本**。

---

## 一、服务器配置要求

| 项目 | 要求 |
| --- | --- |
| CPU | 4 核及以上（推荐 8 核） |
| 内存 | 8 GB 及以上（推荐 16 GB） |
| 磁盘 | 50 GB 及以上（录制文件会持续占用） |
| 操作系统 | 统信 UOS 20 / 中科方德（DEB 系）/ Debian 11+ / Ubuntu 20.04+ |
| 依赖 | 无（内嵌 Node.js、默认 SQLite + 内存 Redis、证书生成纯 JS） |

## 二、操作系统与架构要求

| 架构 | 安装包 | 典型 CPU |
| --- | --- | --- |
| x86_64 | `meeting-<ver>-<rel>_amd64.deb` | 海光、兆芯 |
| aarch64 | `meeting-<ver>-<rel>_arm64.deb` | 鲲鹏、飞腾 |

> ⚠️ **安装包架构必须与目标机 CPU 架构一致**，跨架构无法安装。

## 三、端口要求

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| 8088 | TCP | 网关（Web + API + WebSocket 入口） |
| 40000-40100 | UDP | WebRTC 媒体（可通过 `RTC_MIN_PORT` / `RTC_MAX_PORT` 调整） |

> 若部署在云平台，安全组需**单独放行 UDP 40000-40100 入方向**，否则能进会议但看不到对方、听不到声音。

## 四、安装说明

> 📦 安装包由 GitHub Actions 构建（推送 `v*` tag 自动产出 x64 + arm64 全部产物），从 Actions → Artifacts 下载 `meeting-deb-<arch>-<ver>-<rel>` 即可。

### 4.1 首次安装

```bash
# 1) 安装
sudo dpkg -i meeting-0.0.8-1_amd64.deb
# 若提示依赖缺失（一般不会出现）
sudo apt-get install -f

# 2) 配置（交互式，推荐）
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs
# 交互引导：数据库 → Redis → WebRTC IP → 端口 → 证书 → 迁移 → 管理员 → 启动

# 或手动配置
sudo cp /opt/meeting/conf/env.example /opt/meeting/conf/.env
sudo vi /opt/meeting/conf/.env
```

必改项：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `MEDIASOUP_ANNOUNCED_IP` | `10.0.0.10` | **客户端可达的服务器 IP**，切勿用 127.0.0.1 |
| `DB_DRIVER` | `sqlite` | `sqlite`（默认）/ `mysql` / `postgres` |
| `REDIS_HOST` | `memory` | `memory`（默认，单节点）/ `127.0.0.1` |

```bash
# 3) 生成证书（可选，纯 JS 不依赖 OpenSSL）
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs <服务器IP>
# 信创环境推荐 CA 模式（ca.crt 导入客户端信任库）
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs --ca <服务器IP>

# 4) 启动服务
sudo systemctl daemon-reload
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway
```

安装时自动完成：创建 `meeting` 用户 → 部署 `/opt/meeting/` → 安装 systemd 单元 → 创建 `data/`、`logs/`、`certs/` → 设置属主 → `daemon-reload`。

> 💡 `meeting-api.service` 的 `ExecStartPre` 会在启动时**自动执行数据库迁移**、 `ExecStartPost` 自动写入管理员，无需手动操作。

### 4.2 访问验证

| 项 | 地址 |
| --- | --- |
| 浏览器入口 | `https://<服务器IP>:8088/`（有证书）或 `http://<服务器IP>:8088/` |
| 健康检查 | `curl -k https://127.0.0.1:8088/api/healthz` |
| 默认账号 | `admin / admin123` |

### 4.3 服务管理

```bash
sudo systemctl start|stop|restart meeting-api
sudo systemctl start|stop|restart meeting-realtime
sudo systemctl start|stop|restart meeting-gateway

sudo systemctl status meeting-api meeting-realtime meeting-gateway

# 实时日志
sudo journalctl -u meeting-api -f
# 或日志文件（标准输出与错误合并为同一文件）
tail -f /opt/meeting/logs/*.log
```

无 systemd 时（纯 Node.js）：

```bash
sudo -u meeting /opt/meeting/runtime/bin/node /opt/meeting/bin/start-all.mjs
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/stop-all.mjs
```

## 五、默认账号说明

| 账号 | 密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| admin | admin123 | 超级管理员 | 全部权限 |
| system | system123 | 超级管理员 | 隐藏系统用户 |
| sysadmin | Admin@123 | 系统管理员 | 首次登录提示修改密码 |
| authadmin | Admin@123 | 授权管理员 | 会议/用户审批 |
| auditadmin | Admin@123 | 审计管理员 | 仅查看日志 |
| meeting | Admin@123 | 普通用户 | 首次登录提示修改密码 |
| test1-test5 | 123456 | 普通用户 | 测试用户 |

> 生产环境部署后请立即修改所有默认密码。三员分立：系统管理员管用户但不能审批；授权管理员审批但不能直接操作用户；审计管理员仅查看日志。

## 六、升级说明

```bash
# 0) 备份（必做）
sudo cp /opt/meeting/conf/.env /opt/meeting/conf/.env.bak
sudo cp /opt/meeting/data/meeting.sqlite ./meeting-$(date +%F).sqlite   # SQLite 场景

# 1) 直接覆盖升级（保留 .env / data / certs）
sudo dpkg -i meeting-0.0.9-1_amd64.deb

# 2) 重启服务（API 启动时自动迁移）
sudo systemctl restart meeting-api meeting-realtime meeting-gateway
```

> `dpkg -i` 覆盖安装会保留 `/opt/meeting/conf/.env`、`/opt/meeting/data/`、`/opt/meeting/certs/`，**无需手工执行迁移脚本**。

### 升级后验收

- [ ] `curl -k https://<IP>:8088/api/healthz` 返回 `{"ok":true}`
- [ ] `admin` 可登录；快速会议可入会
- [ ] 预约会议可提交申请，`authadmin` 审批通过后可发起
- [ ] 屏幕共享全屏无无限嵌套（共享者本地不显示自己的共享预览）
- [ ] 音视频、聊天、主持人管控正常
- [ ] 日志正常写入 `/opt/meeting/logs/*.log`

## 七、卸载说明

```bash
# 卸载（保留配置与数据）
sudo dpkg -r meeting
# 连同配置清除（谨慎）
sudo dpkg -P meeting

# 如需彻底清理数据
sudo rm -rf /opt/meeting/data /opt/meeting/logs
```

## 八、国产系统注意事项

| 事项 | 说明 |
| --- | --- |
| systemd 版本 | 单元已兼容 **systemd 219**（麒麟 V10 SP1）：日志由服务内重定向写入 `/opt/meeting/logs/*.log` |
| SELinux | 麒麟默认 `enforcing`，8088 端口需放行：`semanage port -a -t http_port_t -p tcp 8088` |
| 防火墙 | `firewall-cmd --add-port=8088/tcp --add-port=40000-40100/udp --permanent && firewall-cmd --reload` |
| 证书 | 内网用 `gen-cert.mjs --ca <IP>` 生成 CA 证书，`ca.crt` 导入客户端信任库 |
| 浏览器 | 奇安信浏览器（涉密版）/ UOS 浏览器 / Chrome 100+ 均可；前端构建目标 ES2020 |
