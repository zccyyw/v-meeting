# 项目部署说明文档
# 离线发布包部署

## 一、服务器配置

| 配置项 | 最低配置 | 推荐配置 | 说明 |
| --- | --- | --- | --- |
| CPU | 4 核 | 8 核以上 | mediasoup 音视频转发需要一定算力 |
| 内存 | 8 GB | 16 GB 以上 | 内存占用与并发会议数相关 |
| 磁盘 | 100 GB | 200 GB 以上 | 系统 + 应用 + 数据库 + 录制文件存储 |
| 网络 | 百兆 | 千兆以上 | WebRTC 音视频对带宽和延迟敏感 |

以上为 50 人以下并发会议的合理基线，更多并发请按线性增长评估。

## 二、操作系统与架构要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Linux（含银河麒麟 V10、统信 UOS、中科方德等国产系统） | 通过 systemd 或启动脚本托管 |
| CPU 架构 | x86_64（海光/兆芯）或 aarch64（鲲鹏/飞腾） | 安装包架构必须与目标机 CPU 一致；mediasoup 原生模块不可跨架构，构建机必须与目标机同架构 |
| Node.js | 需预装 20 及以上 | 需在 PATH 中（国产系统自带版本可能偏低，建议从官方 tarball 安装） |
| Redis | 需安装 7.x | 会话与瞬时状态存储 |
| 数据库 | SQLite（默认，零依赖）/ MySQL 8 / PostgreSQL 12+ | 三选一，在 .env 中通过 DB_DRIVER 切换 |
| 构建机 | 同架构 Linux + Node.js 20+ | 需可访问 npm 网络 |

## 三、开放端口

| 端口 | 协议 | 用途 | 说明 |
| --- | --- | --- | --- |
| 8088 | TCP | Web 访问入口（内置网关，支持 HTTPS） | 可通过 GATEWAY_PORT 修改 |
| 40000-41000 | UDP | WebRTC 音视频媒体 | 防火墙/安全组必须单独放行 |
| 8080 / 8082 | TCP | API / 信令（内部端口） | 仅供本机内部访问，无需对外放行 |

注意：WebRTC 音视频走 UDP 40000-41000，与 Web 访问的 TCP 端口是两套独立通路。云平台通常默认只放行 80/443，必须单独放行该 UDP 段入方向，否则会议能进入但看不到对方画面、听不到声音。

放行示例（firewalld）：

```bash
sudo firewall-cmd --permanent --add-port=8088/tcp
sudo firewall-cmd --permanent --add-port=40000-41000/udp
sudo firewall-cmd --reload
```

连通性验证：部署后在浏览器打开会议页面，服务器上抓包确认 UDP 媒体流到达：

```bash
sudo tcpdump -i any -n 'udp and portrange 40000-41000'
```

## 四、安装说明

### 步骤 1：获取并传输离线包

从 GitHub 仓库 Actions 页面下载对应架构的 Native 构建产物（meeting-native-x64-*.zip 或 meeting-native-arm64-*.zip，内含 meeting-linux-<架构>-<日期>.tar.gz），传输到目标机：

```bash
scp meeting-linux-<架构>-<日期>.tar.gz user@<目标机IP>:/tmp/
```

安装前确认目标机 Node.js 版本（需 20+）与 CPU 架构：

```bash
node -v     # 需 v20 及以上
uname -m    # 输出 x86_64 或 aarch64，与离线包架构对应
```

### 步骤 2：解压并授权脚本

```bash
cd /tmp
tar -xzf meeting-linux-<架构>-<日期>.tar.gz
cd meeting-linux-<架构>-<日期>
chmod +x install.sh
```

如从 Windows 中转过文件，建议统一修复行尾与权限：

```bash
sudo yum install -y dos2unix 2>/dev/null; dos2unix install.sh 2>/dev/null || true
```

### 步骤 3：执行安装

```bash
sudo ./install.sh
```

安装脚本自动完成：校验架构与 Node 版本、创建系统用户 meeting、部署到 /opt/meeting、生成 /opt/meeting/conf/.env、安装 systemd 单元（meeting-api / meeting-realtime / meeting-gateway）、执行数据库迁移与默认账号写入、启动全部服务。

常用安装环境变量：MEETING_PREFIX（安装目录，默认 /opt/meeting）、MEETING_USER（运行用户，默认 meeting）、MEETING_SKIP_SEED（设为 1 跳过写入默认账号）。

### 步骤 4：配置

```bash
sudo vi /opt/meeting/conf/.env
```

必改项：MEDIASOUP_ANNOUNCED_IP 设为客户端可达的服务器 IP（切勿填 127.0.0.1）；数据库与 Redis 连接参数（SQLite 默认零依赖）。改完后重启：

```bash
sudo systemctl restart meeting-api meeting-realtime meeting-gateway
```

### 步骤 5：访问验证

浏览器打开 http://<服务器IP>:8088/（配置证书后为 https），使用默认账号登录；或执行健康检查：

```bash
curl http://127.0.0.1:8088/api/healthz
```

查看服务运行状态：

```bash
sudo systemctl status meeting-api meeting-realtime meeting-gateway
```

## 五、升级说明

升级前备份（必做）：

```bash
sudo cp /opt/meeting/conf/.env /opt/meeting/conf/.env.bak
sudo cp /opt/meeting/data/meeting.sqlite ./meeting-backup-$(date +%F).sqlite
```

执行升级（解压新包后重新安装）：

```bash
tar -xzf meeting-linux-<架构>-<新日期>.tar.gz
cd meeting-linux-<架构>-<新日期>
sudo ./install.sh
```

install.sh 保留已有的 /opt/meeting/conf/.env，覆盖程序文件并自动执行数据库迁移。数据库迁移通常不可逆，回滚请保留旧离线包，用旧包重新执行 install.sh 恢复。

升级后检查：健康检查返回正常、admin 可登录、创建快速会议可入会、预约会议提交后可审批并可发起、双人流媒体音视频正常、群组置顶正常。

## 六、卸载说明

```bash
sudo systemctl disable --now meeting-api meeting-realtime meeting-gateway
sudo rm -f /etc/systemd/system/meeting-*.service
sudo systemctl daemon-reload
sudo rm -rf /opt/meeting
```

数据库与 Redis 数据请按需决定是否删除。

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

- 架构一致性：安装包架构（x86_64/aarch64）必须与目标机 CPU 一致，构建机必须同架构。
- Node.js 来源：建议从官方 tarball 安装 20+，国产系统自带版本可能偏低；可执行 node -v 确认。
- 脚本权限：如遇 Permission denied，执行 chmod +x install.sh。
- systemd 兼容：服务单元已兼容 systemd 219（银河麒麟 V10 SP1），日志统一写入 /opt/meeting/logs/ 下文件；无 systemd 环境可用 /opt/meeting/bin/start-all.sh 与 stop-all.sh。
- SELinux：如开启 enforcing 模式，需放行网关端口：semanage port -a -t http_port_t -p tcp 8088。
- 客户端浏览器：推荐奇安信浏览器（涉密版）、UOS 浏览器或 Chrome 100+；前端构建目标为 ES2020，兼容较老 Chromium 内核。
- 会议无声音/无画面：绝大多数为 UDP 40000-41000 未放行，见"三、开放端口"抓包排查。
- 证书信任：信创涉密浏览器不信任自签名证书，必须使用 CA 签发模式并导入根证书。
