# 项目部署说明文档
# RPM 包部署

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
| 操作系统 | Linux（RPM 系） | 中科方德、银河麒麟 V10、openEuler、CentOS 7+、RHEL 等 RPM 系操作系统 |
| CPU 架构 | x86_64（海光/兆芯）或 aarch64（鲲鹏/飞腾） | 安装包架构必须与目标机 CPU 一致，跨架构无法安装 |
| Node.js | 无需预装 | RPM 内嵌 Node.js 22 运行时（要求系统 glibc 2.28 及以上，银河麒麟 V10 SP2/SP3 满足；SP1 不支持本方式，请改用 Docker 镜像部署） |
| Redis | 无需预装 | 默认使用进程内内存存储（REDIS_HOST=memory），单节点零依赖 |
| 数据库 | 无需预装 | 默认 SQLite，数据文件在 /opt/meeting/data/meeting.sqlite；可选切换 MySQL 8 / PostgreSQL 12+ |
| 管理方式 | systemd | 服务由 systemd 托管，单元文件安装到 /usr/lib/systemd/system/ |

RPM 包特点：内嵌 Node.js、默认 SQLite + 内存 Redis 零外部依赖、不依赖任何 .sh 脚本（适合禁止执行 shell 脚本的安全环境）、systemd 启动时自动执行数据库迁移、支持 rpm 企业级包管理。

## 三、开放端口

| 端口 | 协议 | 用途 | 说明 |
| --- | --- | --- | --- |
| 8088 | TCP | Web 访问入口（内置网关，自动 HTTPS） | 可通过 GATEWAY_PORT 修改 |
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

### 步骤 1：获取并传输安装包

从 GitHub 仓库 Actions 页面下载对应架构的 RPM 构建产物（meeting-rpm-x64-*.zip 或 meeting-rpm-arm64-*.zip，内含 meeting-<版本>-<发行号>.x86_64.rpm 或 .aarch64.rpm），传输到目标机：

```bash
scp meeting-<版本>-<发行号>.x86_64.rpm user@<目标机IP>:/tmp/
```

安装前确认目标机 CPU 架构与安装包一致：

```bash
uname -m    # 输出 x86_64 对应 x86_64 包；输出 aarch64 对应 aarch64 包
```

### 步骤 2：安装 RPM 包

```bash
sudo rpm -ivh meeting-<版本>-<发行号>.x86_64.rpm
```

安装过程自动完成：创建系统用户 meeting、部署文件到 /opt/meeting、安装 systemd 单元、创建 data/logs/certs 目录并设置属主、刷新 systemd。

如提示包已安装，需先卸载旧版或改用升级命令（见"五、升级说明"）。

### 步骤 3：配置

方式一，交互式配置（推荐）：

```bash
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs
```

方式二，手动配置：

```bash
sudo cp /opt/meeting/conf/env.example /opt/meeting/conf/.env
sudo vi /opt/meeting/conf/.env
```

必改项：MEDIASOUP_ANNOUNCED_IP 设为客户端可达的服务器 IP（切勿填 127.0.0.1）。默认 DB_DRIVER=sqlite、REDIS_HOST=memory 即可零依赖运行；如需切换 MySQL 或 PostgreSQL，按 env.example 内注释填写连接参数，并提前建库。

### 步骤 4：生成证书（可选）

```bash
sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs <服务器IP>
```

生成证书后网关自动启用 HTTPS（浏览器入口变为 https）。信创环境请使用 --ca 参数以 CA 签发模式生成根证书与服务器证书，并将 ca.crt 导入客户端浏览器/系统信任机构。

### 步骤 5：启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway
```

API 服务启动前会自动执行数据库迁移并写入默认账号，无需手动操作。

### 步骤 6：访问验证

浏览器打开 https://<服务器IP>:8088/（未生成证书则为 http），使用默认账号登录；或执行健康检查：

```bash
curl -k https://127.0.0.1:8088/api/healthz
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

执行升级：

```bash
sudo rpm -Uvh meeting-<新版本>-<发行号>.x86_64.rpm
sudo systemctl restart meeting-api meeting-realtime meeting-gateway
```

rpm -Uvh 保留 /opt/meeting/conf/.env、data、certs 不被覆盖；API 服务重启时自动执行数据库迁移，无需手动跑迁移脚本。数据库迁移通常不可逆，回滚请优先使用备份恢复。

升级后检查：健康检查返回正常、admin 可登录、创建快速会议可入会、预约会议提交后可审批并可发起、双人流媒体音视频正常、群组置顶正常。

## 六、卸载说明

```bash
sudo rpm -e meeting
```

卸载自动停止服务、删除程序文件与 systemd 单元，保留配置与数据目录。如需彻底清理数据（谨慎）：

```bash
sudo rm -rf /opt/meeting/data /opt/meeting/logs
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

- 架构一致性：安装包架构（x86_64/aarch64）必须与目标机 CPU 一致。
- glibc 版本：内嵌 Node.js 要求系统 glibc 2.28 及以上；银河麒麟 V10 SP1 请改用 Docker 镜像部署。
- Node 命令路径：目标机无需安装 node，所有管理脚本使用完整路径 /opt/meeting/runtime/bin/node 执行。
- systemd 兼容：服务单元已兼容 systemd 219（麒麟 V10 SP1），日志统一写入 /opt/meeting/logs/ 下文件。
- SELinux：如开启 enforcing 模式，需放行网关端口：semanage port -a -t http_port_t -p tcp 8088。
- 客户端浏览器：推荐奇安信浏览器（涉密版）、UOS 浏览器或 Chrome 100+；前端构建目标为 ES2020，兼容较老 Chromium 内核。
- 会议无声音/无画面：绝大多数为 UDP 40000-41000 未放行，见"三、开放端口"抓包排查。
- 证书信任：信创涉密浏览器不信任自签名证书，必须使用 CA 签发模式并导入根证书。
