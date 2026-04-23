# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NODE_ENV=production
WORKDIR /workspace

RUN npm install -g corepack@0.31.0 \
 && corepack enable \
 && corepack prepare pnpm@9.15.4 --activate

FROM base AS builder
COPY . /workspace
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter my-brain-web run build

FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app

RUN groupadd -g 1001 mybrain \
 && useradd -u 1001 -g mybrain -m -d /app -s /usr/sbin/nologin mybrain

COPY --from=builder --chown=mybrain:mybrain /workspace/src/web/.next/standalone ./
COPY --from=builder --chown=mybrain:mybrain /workspace/src/web/.next/static ./src/web/.next/static
COPY --from=builder --chown=mybrain:mybrain /workspace/src/web/public ./src/web/public

USER mybrain
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/web/server.js"]
