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
ENV MCP_SERVER_NAME=my-brain
ENV MCP_SERVER_VERSION=0.1.0
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=3737
ENV EMBEDDING_PROVIDER=minilm
ENV EMBEDDING_MODEL_ID=sentence-transformers/all-MiniLM-L6-v2
ENV EMBEDDING_DIM=384
ENV EMBEDDING_QUANTIZED=false
ENV MODEL_CACHE_DIR=/models
ENV SONA_MICRO_LORA_RANK=2
ENV SONA_BASE_LORA_RANK=16
ENV SONA_MICRO_LORA_LR=0.002
ENV SONA_QUALITY_THRESHOLD=0.3
ENV SONA_PATTERN_CLUSTERS=100
ENV SONA_EWC_LAMBDA=2000
ENV RUVECTOR_DB_PATH=/data/ruvector.db

RUN groupadd -r appuser && useradd --no-log-init -r -g appuser appuser

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p /data /models && chown -R appuser:appuser /app /data /models

USER appuser

EXPOSE 3737

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MCP_HTTP_PORT || '3737') + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
