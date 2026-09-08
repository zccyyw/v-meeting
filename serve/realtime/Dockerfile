FROM node:22-bookworm AS deps
WORKDIR /app
# mediasoup worker 获取策略：
#   默认优先下载官方预编译二进制（秒级；x64/arm64 均有 kernel6 发布产物）；
#   下载/校验失败时自动回退本地 C++ 编译（需 pip 安装 meson/ninja/invoke）。
# 本地编译在 qemu 下耗时数小时且依赖 PyPI，因此默认关闭。需要时显式开启：
#   --build-arg SKIP_WORKER_PREBUILT=true
#   --build-arg PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
# 另：低内核（kernel<6，如 CentOS 7）无对应预编译产物，也会自动回退本地编译。
# 默认官方 PyPI：CI（境外 runner）可直接访问；国内网络按上面方式覆盖。
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG GHPROXY=https://gh-proxy.com
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    python3-setuptools \
    python3-venv \
    build-essential \
    cmake \
  && rm -rf /var/lib/apt/lists/*

# Debian 12 (bookworm) Python 受 PEP 668 externally-managed 限制：
# 系统 python3 禁止裸 pip install，mediasoup postinstall 内的
# `pip install --target ... invoke` 会因此失败。建独立 venv（自带 pip、
# 不受该限制）并让 mediasoup 通过 $PYTHON 使用它。
RUN python3 -m venv /opt/mediasoup-venv \
  && /opt/mediasoup-venv/bin/python -m pip install --no-input --upgrade pip

COPY package.json package-lock.json ./
COPY serve/shared/package.json ./serve/shared/
COPY serve/db/package.json ./serve/db/
COPY serve/api/package.json ./serve/api/
COPY serve/realtime/package.json ./serve/realtime/
COPY front/package.json ./front/
COPY client/package.json ./client/
RUN npm ci --ignore-scripts -w @meeting/shared -w @meeting/db -w @meeting/realtime

# Patch mediasoup's meson wrap files to use gh-proxy mirror, then build worker.
COPY serve/realtime/patch-mediasoup-wrap.cjs ./patch-mediasoup-wrap.cjs
ENV PYTHON=/opt/mediasoup-venv/bin/python
# 默认优先下载官方预编译 worker（秒级，x64/arm64 均有对应二进制）；
# 本地编译在 qemu 下需数小时、且依赖 pip 安装 invoke，仅作为下载失败时的
# 自动回退路径。国内网络无法访问 GitHub Releases 时显式开启本地编译：
#   --build-arg SKIP_WORKER_PREBUILT=true
ARG SKIP_WORKER_PREBUILT=false
RUN node ./patch-mediasoup-wrap.cjs ${GHPROXY} \
  && cd node_modules/mediasoup \
  && if [ "${SKIP_WORKER_PREBUILT}" = "true" ]; then \
       echo "→ local mediasoup-worker build requested"; \
       export MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=true; \
     else \
       echo "→ prefer mediasoup-worker prebuilt download"; \
       unset MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD; \
     fi \
  && node npm-scripts.mjs postinstall \
  && cd /app && npm rebuild better-sqlite3

COPY serve/shared ./serve/shared
COPY serve/db ./serve/db
COPY serve/realtime ./serve/realtime
RUN npm run build -w @meeting/shared \
  && npm run build -w @meeting/db \
  && npm run build -w @meeting/realtime

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
WORKDIR /app/serve/realtime
EXPOSE 8082
EXPOSE 40000-40100/udp
CMD ["node", "dist/index.js"]
