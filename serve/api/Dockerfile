FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY serve/shared/package.json ./serve/shared/
COPY serve/db/package.json ./serve/db/
COPY serve/api/package.json ./serve/api/
COPY serve/realtime/package.json ./serve/realtime/
COPY front/package.json ./front/
COPY client/package.json ./client/
RUN npm ci -w @meeting/shared -w @meeting/db -w @meeting/api

COPY serve/shared ./serve/shared
COPY serve/db ./serve/db
COPY serve/api ./serve/api
RUN npm run build -w @meeting/shared \
  && npm run build -w @meeting/db \
  && npm run build -w @meeting/api \
  && mkdir -p serve/api/dist/sql \
  && cp -r serve/api/src/sql/. serve/api/dist/sql/

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
WORKDIR /app/serve/api
EXPOSE 8080
CMD ["sh", "-c", "node dist/migrate.js && node dist/seed-admin.js && node dist/index.js"]
