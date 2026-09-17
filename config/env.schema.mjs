/**
 * 环境变量模板的「单一事实来源」。
 *
 * 由 scripts/gen-env-templates.mjs 生成三份模板（勿手工编辑生成产物）：
 *   dev    → .env.example                        （本地开发）
 *   host   → deploy/native/conf/env.example      （RPM / DEB / Native 离线包）
 *   docker → .env.production.example             （Docker Compose 在线/离线镜像）
 *
 * 分层约定（务必遵守，避免"模板里有、实际无效"的误导）：
 *   · 运行时参数：DB_* / REDIS_* / MEDIASOUP_* / RTC_* / 端口 / MEETING_* —— 所有端都列
 *   · 前端参数：VITE_APP_NAME 例外地三端都列 —— docker(web 容器) 与 主机(网关) 都在
 *     启动时动态输出 /app-config.js 运行时注入（安装前改 .env、启动后生效，见部署文档）；
 *     其余 VITE_* 只在 dev / docker 列（构建期生效）。
 *     VITE_APP_LOGO / VITE_PWA_ENABLED 已停用（active:false，模板中输出为注释）：
 *     logo 改为「替换 favicon.svg/favicon.ico 文件」；PWA 代码整体注释待恢复
 *     （恢复方法见 front/vite.config.ts 与 front/src/main.tsx 的 [PWA-RESTORE] 标注）。
 *   · 编排期参数：COMPOSE_PROFILES / MYSQL_ROOT_PASSWORD / POSTGRES_* —— 仅 docker
 *
 * 字段说明（每个条目）：
 *   section   开始一个新章节（值作为章节标题）
 *   key       变量名
 *   value     默认值：字符串，或 { dev|host|docker: string }
 *   active    false = 以注释形式给出（示例/可选开关），默认 true
 *   targets   限定出现在哪些端，默认三端都出
 *   comment   该变量上方的说明行（自动加 "# " 前缀）
 *   raw       原样输出的注释行（用于较长的说明块）
 */

export const TARGETS = ["dev", "host", "docker"];

export const TARGET_FILES = {
  dev: ".env.example",
  host: "deploy/native/conf/env.example",
  docker: ".env.production.example",
};

export const HEADERS = {
  dev: [
    "# ============================================================",
    "# ⚠️ 适用场景：本地开发调试",
    "# 生产部署请使用对应模板（三份模板由 config/env.schema.mjs 统一生成）：",
    "#   · Docker Compose 在线部署 / 离线镜像部署 → .env.production.example",
    "#   · RPM / DEB / Native 离线包（主机部署） → deploy/native/conf/env.example",
    "# 关键差异：本文件的 VITE_API_BASE / VITE_WS_URL 为「本地直连」值，",
    "# 生产环境取值不同（/api、auto），混用会导致前端请求不到 API。",
    "# Docs: docs/install/ · docs/变更日志.md",
    "# ============================================================",
  ],
  host: [
    "# ============================================================",
    "# ⚠️ 适用场景：RPM / DEB / Native 离线包（主机部署，无容器）",
    "# 该模板随安装包部署为 /opt/meeting/conf/env.example。",
    "# 其他场景请勿使用：",
    "#   · 本地开发调试                      → .env.example",
    "#   · Docker Compose 在线 / 离线镜像部署 → .env.production.example",
    "# 注意：品牌与 PWA 属于「前端构建期」参数，已烤进安装包，本文件不含 VITE_*。",
    "# 交互式配置向导：sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs",
    "# ============================================================",
  ],
  docker: [
    "# ============================================================",
    "# ⚠️ 适用场景：Docker Compose 在线部署 / Docker 离线镜像部署",
    "# 该文件会被 pack:docker 复制为离线包内的 env.example（离线部署用同一模板）。",
    "# 其他场景请勿使用：",
    "#   · 本地开发调试                    → .env.example",
    "#   · RPM / DEB / Native 离线包（主机部署）→ deploy/native/conf/env.example",
    "# 直接 docker-compose up -d 启动，无需 -f / --profile / --env-file 参数",
    "# Docs: docs/install/本地部署说明-docker.md · docs/变更日志.md",
    "# ============================================================",
  ],
};

const ALL = ["dev", "host", "docker"];

export const SCHEMA = [
  // ─────────────────────────────── Database ───────────────────────────────
  { section: "Database（默认 MySQL；单机可用 SQLite，或 PostgreSQL）" },
  {
    key: "DB_DRIVER",
    value: "mysql",
    comment: [
      "mysql（默认，需先建库建用户） | sqlite（零依赖，仅单机） | postgres",
      "注意：其它拼写会按 mysql 处理（详见部署说明 5.1）",
    ],
  },
  {
    key: "MYSQL_HOST",
    value: "127.0.0.1",
  },
  { key: "MYSQL_PORT", value: "3306" },
  {
    key: "MYSQL_USER",
    value: "meeting",
  },
  {
    key: "MYSQL_PASSWORD",
    value: { dev: "meetingpass", host: "meetingpass", docker: "change-me" },
    comment: ["生产环境务必修改"],
  },
  { key: "MYSQL_DATABASE", value: "meeting" },
  {
    key: "MYSQL_ROOT_PASSWORD",
    targets: ["docker"],
    value: "change-me-root",
    comment: ["仅 MySQL 容器使用（profile=mysql）；生产务必修改"],
  },

  { section: "Database · SQLite（可选，零依赖）" },
  {
    key: "DB_DRIVER",
    value: "sqlite",
    active: false,
    comment: ["改用 SQLite 时：取消下面两行注释，并注释掉上面的 MYSQL_* 各行"],
  },
  {
    key: "SQLITE_PATH",
    value: {
      dev: "./data/meeting.sqlite",
      host: "/opt/meeting/data/meeting.sqlite",
      docker: "/app/data/meeting.sqlite",
    },
    active: false,
    comment: ["SQLite 数据文件（建议与 data/ 一起备份）"],
  },

  { section: "Database · PostgreSQL（可选）" },
  {
    key: "DB_DRIVER",
    value: "postgres",
    active: false,
    comment: ["改用 PostgreSQL 时：取消下列注释，并注释掉上面的 MYSQL_* 各行"],
  },
  { key: "PGHOST", value: "127.0.0.1", active: false },
  { key: "PGPORT", value: "5432", active: false },
  { key: "PGUSER", value: "meeting", active: false },
  { key: "PGPASSWORD", value: "meetingpass", active: false },
  { key: "PGDATABASE", value: "meeting", active: false },
  {
    key: "POSTGRES_USER",
    targets: ["docker"],
    value: "postgres",
    comment: ["仅 PostgreSQL 容器使用（profile=postgres）"],
  },
  { key: "POSTGRES_PASSWORD", targets: ["docker"], value: "postgres" },
  { key: "POSTGRES_DB", targets: ["docker"], value: "meeting" },

  // ──────────────────────────────── Redis ────────────────────────────────
  { section: "Redis（内存库：登录会话与实时状态）" },
  {
    key: "REDIS_HOST",
    targets: ["dev", "host"],
    value: "memory",
    comment: [
      'memory（默认）或留空 = 进程内内存实现：零依赖，仅单机单实例，重启会丢会话',
      '填真实地址（如 127.0.0.1）= 连接外部 Redis：重启不丢会话，多实例部署必需',
    ],
  },
  {
    key: "REDIS_PORT",
    targets: ["dev", "host"],
    value: "6379",
    active: false,
  },
  {
    key: "REDIS_PASSWORD",
    value: { dev: "", host: "", docker: "change-me-redis" },
    active: { dev: false, host: false, docker: true },
    comment: ["外部 Redis 的密码：Redis 设了密码就必须填，否则连接失败"],
  },
  {
    targets: ["docker"],
    comment: [
      "Docker 部署中：Redis 主机由 compose 内部指定（服务名 redis），",
      "此处只需把 REDIS_PASSWORD 设为强密码（同时是 redis 容器的 requirepass）",
    ],
  },

  // ──────────────────────────────── 端口 ────────────────────────────────
  { section: "Service Ports（端口）" },
  {
    key: "API_PORT",
    value: "8080",
    comment: ["API 内部端口，仅内网/本机，不对外发布"],
  },
  {
    key: "WS_PORT",
    value: "8082",
    comment: ["实时信令内部端口，仅内网/本机，不对外发布"],
  },
  {
    key: "GATEWAY_PORT",
    targets: ["host"],
    value: "443",
    comment: [
      "对外统一入口（HTTPS）。需在 CERT_DIR 放置证书，否则 443 为明文 HTTP",
      "也可改用 Nginx 前置（conf/nginx-meeting-ssl.conf）",
    ],
  },
  {
    key: "FRONT_PORT",
    targets: ["dev"],
    value: "8081",
    comment: ["开发服务器端口（仅本地开发使用；局域网联调需放行该端口）"],
  },

  // ─────────────────────────────── WebRTC ───────────────────────────────
  { section: "WebRTC（局域网/公网访问必配）" },
  {
    key: "MEDIASOUP_ANNOUNCED_IP",
    value: { dev: "127.0.0.1", host: "127.0.0.1", docker: "10.0.0.10" },
    comment: [
      "必改：浏览器可达的服务器 IP / 域名解析结果（同网段填内网 IP，跨 NAT 填公网 IP）",
      "填错会出现「能进会议但看不到/听不到画面」",
    ],
  },
  {
    key: "MEDIASOUP_LISTEN_IP",
    value: "0.0.0.0",
    comment: ["媒体监听地址，通常不用改（仅多网卡需要绑定时才改）"],
  },
  {
    key: "RTC_MIN_PORT",
    value: "40000",
    comment: ["媒体 UDP 段：必须在防火墙/安全组放行（改动后同步放行并重启 meeting-realtime）"],
  },
  { key: "RTC_MAX_PORT", value: "41000" },

  // ──────────────────────────── 证书 / 录制 ────────────────────────────
  { section: "TLS 证书与录制目录" },
  {
    key: "CERT_DIR",
    targets: ["host"],
    value: "/opt/meeting/certs",
    active: false,
    comment: [
      "证书目录（fullchain.pem + privkey.pem）；默认即前缀下 certs/，一般无需设置",
      "生成：sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs --ca <服务器IP>",
      "（native 包另有 bin/genssl.sh；两者都会把证书归属切到 running 用户 meeting）",
    ],
  },
  {
    key: "DEV_CERT_DIR",
    targets: ["dev"],
    value: ".certs",
    active: false,
    comment: ["开发用 HTTPS 证书目录：npm run cert:dev -- <本机局域网IP> 后自动启用"],
  },
  {
    key: "RECORDINGS_DIR",
    value: {
      dev: "./data/recordings",
      host: "/opt/meeting/data/recordings",
      docker: "/app/data/recordings",
    },
    active: false,
  },

  // ─────────────────────────── 会议行为 / 密钥 ───────────────────────────
  { section: "会议行为（自动结束 / 重连窗口 / 兜底扫描）" },
  {
    key: "MEETING_EMPTY_ROOM_GRACE_MS",
    value: "180000",
    comment: [
      '房间空置（最后一人离开）超过该毫秒数后自动把会议置为"已结束"（0 关闭）',
      "注意：结束后原会议链接/会议号不可再加入",
    ],
  },
  {
    key: "MEETING_HOST_RECONNECT_GRACE_MS",
    value: "300000",
    comment: [
      "主持人离开后的重连窗口（断网/崩溃/关页面/误点返回都算可重连的离开）",
      "窗口内主持人回来则会议继续，超时未归才自动结束；0 关闭",
      "真正散会请让主持人点「结束会议」（立即结束，不走该窗口）",
    ],
  },
  {
    key: "MEETING_STALE_SWEEP_MS",
    value: "60000",
    comment: [
      '兜底扫描周期：清理"服务重启后遗留的进行中会议"（房间是内存态，重启会丢定时器）',
      "0 关闭；仅在 realtime 单实例部署下安全（多实例请设 0）",
    ],
  },
  {
    key: "MEETING_CRYPTO_KEY",
    value: { dev: "<随机字符串>", host: "<随机字符串>", docker: "change-me-crypto-key" },
    active: { dev: false, host: false, docker: true },
    comment: [
      "前后端共用的密码传输加密密钥，必须与前端构建时一致（未设置则用内置默认值）",
      "生成：openssl rand -base64 32",
    ],
  },

  // ─────────────────────── 构建期参数（dev/docker） ───────────────────────
  { section: "前端构建期参数（仅构建前端时生效；主机包已在 CI 构建完成，故不含本节）", targets: ["dev", "docker"] },
  {
    key: "VITE_API_BASE",
    targets: ["dev", "docker"],
    value: { dev: "http://127.0.0.1:8080", docker: "/api" },
    comment: [
      "dev：本机直连 API；局域网联调改为 /api（走同源代理，避免混合内容拦截）",
      "docker：由 web 镜像构建时写入（离线包已构建完成，修改无效）",
    ],
  },
  {
    key: "VITE_WS_URL",
    targets: ["dev", "docker"],
    value: { dev: "ws://127.0.0.1:8082", docker: "auto" },
    comment: [
      "dev：本机直连信令；局域网联调改为 auto（同源 ws(s)://<host>/ws）",
      "docker：auto = 同源 wss，一般无需修改",
    ],
  },
  {
    key: "VITE_APP_NAME",
    targets: ["dev", "docker", "host"],
    value: "Meeting",
    comment: [
      "应用名（浏览器标题）—— 运行时生效：docker 由 web 容器启动注入 /app-config.js；主机由网关动态输出 /app-config.js",
      "改后生效方式：docker `docker-compose up -d` 重建 web 容器；主机 `systemctl restart meeting-*` 三服务",
    ],
  },
  {
    key: "VITE_APP_LOGO",
    targets: ["dev", "docker"],
    active: false,
    value: "/favicon.svg",
    comment: [
      "已停用：logo 定制改为「替换 favicon.svg / favicon.ico 文件」（统一放在前端静态目录，见部署文档「品牌定制」）",
      "键保留仅为参考；如需恢复为配置项，去掉行首注释并同步 front/vite.config.ts",
    ],
  },
  {
    key: "VITE_PWA_ENABLED",
    targets: ["dev", "docker"],
    active: false,
    value: "0",
    comment: [
      "已停用：PWA 功能整体注释（2026-09-17），恢复方法见 front/vite.config.ts / front/src/main.tsx 的 [PWA-RESTORE] 标注",
    ],
  },

  // ────────────────────────── docker 编排参数 ──────────────────────────
  { section: "Docker 编排（仅 Docker 部署）", targets: ["docker"] },
  {
    key: "COMPOSE_PROFILES",
    targets: ["docker"],
    value: "mysql",
    comment: [
      "mysql（默认，启动 mysql:8.4 容器） | postgres（启动 postgres:12-alpine） | sqlite（零依赖，无数据库容器）",
      "只需改这一项，DB_DRIVER 会自动跟随",
    ],
  },
];
