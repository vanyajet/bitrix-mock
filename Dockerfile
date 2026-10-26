# syntax=docker/dockerfile:1

# --- 1. Все зависимости (включая dev) для сборки бэкенда и фронта
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

# --- 2. Сборка: tsc -> dist/, vite -> web/dist/
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src src
COPY web web
RUN npm run build

# --- 3. Только production-зависимости бэкенда (фронтовые пакеты - devDependencies воркспейса web)
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --omit=dev --no-audit --no-fund

# --- 4. Runtime-образ
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/web/dist web/dist
COPY migrations migrations
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
