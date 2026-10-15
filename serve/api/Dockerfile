FROM node:22.23-bookworm-slim AS deps
WORKDIR /app
# buildkit 构建网络中 HTTP:80 被 Docker Desktop 内部代理劫持且不可用（HTTP→28.0.0.30:80 失败），
# HTTPS:443 正常；slim 镜像无系统 CA，故 HTTPS 源需在构建期临时关闭证书校验（仅内网镜像源，风险可控）
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    sed -i 's|http://deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::https::Verify-Peer=false -o Acquire::https::Verify-Host=false update \
  && apt-get -o Acquire::https::Verify-Peer=false -o Acquire::https::Verify-Host=false install -y python3 make g++ ca-certificates
COPY package.json package-lock.json ./
COPY serve/shared/package.json ./serve/shared/
COPY serve/db/package.json ./serve/db/
COPY serve/api/package.json ./serve/api/
COPY serve/realtime/package.json ./serve/realtime/
COPY front/package.json ./front/
COPY client/package.json ./client/
# 可选 npm 镜像源：--build-arg NPM_REGISTRY=https://registry.npmmirror.com（默认空=官方源，CI 行为不变）
ARG NPM_REGISTRY=""
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    --mount=type=cache,target=/root/.cache/node-gyp,sharing=locked \
    if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --ignore-scripts -w @meeting/shared -w @meeting/db -w @meeting/api \
 && npm rebuild better-sqlite3 \
 && rm -rf node_modules/better-sqlite3/build/Release/obj node_modules/better-sqlite3/build/Release/obj.target \
            node_modules/better-sqlite3/build/Release/sqlite3.a node_modules/better-sqlite3/build/Release/test_extension.node \
            node_modules/better-sqlite3/build/Release/deps

COPY serve/shared ./serve/shared
COPY serve/db ./serve/db
COPY serve/api ./serve/api
RUN npm run build -w @meeting/shared \
  && npm run build -w @meeting/db \
  && npm run build -w @meeting/api \
  && mkdir -p serve/api/dist/sql \
  && cp -r serve/api/src/sql/. serve/api/dist/sql/

FROM node:22.23-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
WORKDIR /app/serve/api
EXPOSE 8080
# exec 让 node 替换 shell 成为 PID1：SIGTERM 直达 node 触发优雅停机，
# 否则 shell 吞掉信号，docker stop 只能等满 stop_grace_period 后 SIGKILL（实测 30s）
CMD ["sh", "-c", "node dist/migrate.js && node dist/seed-admin.js && exec node dist/index.js"]
