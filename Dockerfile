# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/root/.cache/yarn \
  corepack enable && yarn install --frozen-lockfile

COPY tsconfig.json eslint.config.mjs .prettierrc ./
COPY src ./src
RUN yarn build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN groupadd -r appuser && useradd --no-log-init -r -g appuser appuser

COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/root/.cache/yarn \
  corepack enable \
  && yarn install --frozen-lockfile --production=true \
  && yarn cache clean \
  && rm -rf /usr/local/share/.cache/yarn /root/.npm \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=build /app/dist ./dist

RUN mkdir -p /data /models && chown -R appuser:appuser /app /data /models

USER appuser

EXPOSE 3737

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MCP_HTTP_PORT || '3737') + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
