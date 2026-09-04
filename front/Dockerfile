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
ARG VITE_WS_URL=wss://localhost/ws
ARG VITE_APP_NAME=Meeting
ARG VITE_APP_LOGO=/favicon.svg
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_APP_NAME=$VITE_APP_NAME
ENV VITE_APP_LOGO=$VITE_APP_LOGO

RUN npm run build -w @meeting/shared && npm run build -w @meeting/front

FROM nginx:alpine
COPY front/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/front/dist /usr/share/nginx/html
EXPOSE 80
