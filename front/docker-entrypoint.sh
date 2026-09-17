#!/bin/sh
set -eu
# 运行时配置注入：web 容器启动时把 .env（经 compose environment 透传）写入站点根的
# /app-config.js，实现「安装前改 .env、启动后生效」，无需重建镜像。
# 未设置的键不写入，前端回退构建期默认（打包时的 branding.json / build-arg）。
#
# logo 定制：若挂载的 /branding 目录内有 favicon.svg / favicon.ico，覆盖站点根同名文件
#（对应 docker-compose.yml 的 ./branding 卷挂载，见部署文档「品牌定制」）。

# JS 字符串字面量转义（反斜杠、双引号）
js() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

f=/usr/share/nginx/html/app-config.js
{
  echo '/* 由 web 容器启动时生成（来源：.env），请勿手工编辑 */'
  echo '(function () {'
  echo '  var c = window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};'
  if [ -n "${VITE_APP_NAME:-}" ]; then
    echo "  c.appName = \"$(js "$VITE_APP_NAME")\";"
    echo '  document.title = c.appName;'
    echo "  var m = document.querySelector('meta[name=\"apple-mobile-web-app-title\"]');"
    echo '  if (m) m.setAttribute("content", c.appName);'
  fi
  if [ -n "${MEETING_CRYPTO_KEY:-}" ]; then
    echo "  c.cryptoKey = \"$(js "$MEETING_CRYPTO_KEY")\";"
    echo '  window.__MEETING_CRYPTO_KEY__ = c.cryptoKey;'
  fi
  if [ -n "${VITE_API_BASE:-}" ]; then
    echo "  c.apiBase = \"$(js "$VITE_API_BASE")\";"
  fi
  if [ -n "${VITE_WS_URL:-}" ]; then
    echo "  c.wsUrl = \"$(js "$VITE_WS_URL")\";"
  fi
  echo '})();'
} > "$f"
echo '-> app-config.js generated (runtime config)'

if [ -d /branding ]; then
  if [ -f /branding/favicon.svg ]; then
    cp /branding/favicon.svg /usr/share/nginx/html/favicon.svg
    echo '-> branding: favicon.svg replaced'
  fi
  if [ -f /branding/favicon.ico ]; then
    cp /branding/favicon.ico /usr/share/nginx/html/favicon.ico
    echo '-> branding: favicon.ico replaced'
  fi
fi

exec "$@"
