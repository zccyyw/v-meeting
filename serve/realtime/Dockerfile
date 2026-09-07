FROM node:22-bookworm AS deps
WORKDIR /app
# mediasoup on old kernels (e.g. CentOS 7, kernel 3.10): no prebuilt worker
# exists for kernel<6 in mediasoup 3.22.0, so we MUST build locally. Local build
# needs pip (meson/ninja/invoke) + libuv source + WrapDB patch, all of which are
# blocked/timeout on CN networks. We work around it by:
#   1) Tsinghua PyPI mirror for pip packages (meson/ninja/invoke)
#   2) --ignore-scripts so mediasoup postinstall doesn't run before we patch it
#   3) rewrite libuv.wrap URLs to gh-proxy + GitHub wrapdb releases (reachable)
#   4) run mediasoup postinstall manually to trigger local C++ build
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG GHPROXY=https://gh-proxy.com
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=true
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
RUN node ./patch-mediasoup-wrap.cjs ${GHPROXY} \
  && cd node_modules/mediasoup && node npm-scripts.mjs postinstall \
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
