# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json eslint.config.mjs .prettierrc ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN groupadd -r appuser && useradd --no-log-init -r -g appuser appuser

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p /data /models && chown -R appuser:appuser /app /data /models

USER appuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const fs=require('node:fs');fs.accessSync('/data', fs.constants.W_OK);"

CMD ["node", "dist/index.js"]
