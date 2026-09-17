FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY serve/shared/package.json ./serve/shared/
COPY serve/db/package.json ./serve/db/
COPY serve/api/package.json ./serve/api/
COPY serve/realtime/package.json ./serve/realtime/
COPY front/package.json ./front/
COPY client/package.json ./client/
RUN npm ci -w @meeting/shared -w @meeting/front

COPY serve/shared ./serve/shared
COPY front ./front

ARG VITE_API_BASE=/api
ARG VITE_WS_URL=auto
ARG VITE_APP_NAME=Meeting
ARG VITE_APP_LOGO=/favicon.svg
ARG VITE_PWA_ENABLED=0
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_APP_NAME=$VITE_APP_NAME
ENV VITE_APP_LOGO=$VITE_APP_LOGO
ENV VITE_PWA_ENABLED=$VITE_PWA_ENABLED

RUN npm run build -w @meeting/shared && npm run build -w @meeting/front

FROM nginx:alpine
COPY front/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/front/dist /usr/share/nginx/html
# 运行时品牌注入：容器启动时把环境变量 VITE_APP_NAME（来自 .env → compose environment）
# 写入站点根的 /branding.js —— 应用名支持「安装前改 .env、启动后生效」，无需重建镜像。
COPY front/docker-entrypoint.sh /usr/local/bin/meeting-web-entrypoint.sh
RUN chmod +x /usr/local/bin/meeting-web-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/meeting-web-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 80
