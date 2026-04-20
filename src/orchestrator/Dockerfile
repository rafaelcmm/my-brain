# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NODE_ENV=production
WORKDIR /app

RUN npm install -g corepack@0.31.0 \
 && corepack enable \
 && corepack prepare pnpm@9.15.4 --activate

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

FROM base AS prod-deps
COPY src/orchestrator/package.json src/orchestrator/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM base AS runner
RUN groupadd -g 1001 mybrain \
 && useradd -u 1001 -g mybrain -m -d /app -s /usr/sbin/nologin mybrain

COPY --from=prod-deps --chown=mybrain:mybrain /app/node_modules ./node_modules
COPY --chown=mybrain:mybrain src/orchestrator/package.json ./
COPY --chown=mybrain:mybrain src/orchestrator/src ./src

USER mybrain
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["node", "src/index.mjs"]
