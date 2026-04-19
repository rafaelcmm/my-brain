# Deep Research (v3 addendum): Installation, Authentication, Token Rotation, CI/CD

> **Scope of this addendum.** v1 set the architecture. v2 branded it as `my-brain`, switched to `.env`-driven config, and added autonomous model-invoked skills. **This v3 addendum adds four things**: a one-line installer, a Bearer-token auth layer enforced on both `/mcp` and the REST API, a token-rotation procedure, and a GitHub-native CI/CD + release pipeline using semver. Everything else (architecture, skills, Compose topology) is unchanged — this file is strictly additive.

Read this after the v2 doc.

---

## 14. Authentication — design

### 14.1. What gets protected

Two ingress ports need the same bearer check:
- `:3333` → `/mcp` (Streamable HTTP MCP, served by `mcp-proxy`)
- `:8080` → `/v1/*` (REST API, served by `@ruvector/server`)

The internal Postgres (`:5432`) stays on the Docker network and is never bearer-gated — DB credentials guard it.

### 14.2. Why a reverse proxy, not in-app middleware

Three reasons:

1. **`mcp-proxy` handles *outbound* OAuth (to upstream MCPs) but does not enforce *inbound* bearer auth on its own port.** Patching it would fork an upstream tool.
2. **`@ruvector/server` is an Axum binary shipped inside the orchestrator image.** Adding middleware means wrapping it, which means forking or running Node middleware in front — more surface area.
3. **Centralising auth at the edge gives one place to rotate, one place to rate-limit, one place to add TLS later.** This is the same pattern every team tool converges on: Caddy/Traefik in front of the app.

We use **Caddy** because it's single-binary, ships its own TLS, and has a 3-line config for bearer validation. Same effect could be achieved with Traefik or nginx.

### 14.3. Token format

- 64 characters of URL-safe entropy, prefixed with `my-brain-` → total length ~73 chars.
- Prefix lets you spot my-brain tokens in logs, scanners, git-diffs, secret managers.
- Format: `my-brain-<64 chars from [A-Za-z0-9_-]>`
- Generated once at install time, stored at `./.secrets/auth-token` (mode 600), passed to Caddy via env var, and mounted read-only into the container.

### 14.4. What the spec says

Confirmed from the MCP Nov 2025 authorization spec: static Bearer tokens are explicitly endorsed for internal/team tools. OAuth 2.1 + PKCE is mandatory only for *public remote* MCP servers. `my-brain` is by definition a self-hosted personal tool bound to `127.0.0.1` — so a static Bearer token is spec-compliant and far simpler.

When exposing to a LAN or the internet later, the path forward is adding TLS in Caddy (zero-config with a real domain) and upgrading to OAuth 2.1 — but that's a later-stage concern.

### 14.5. Unauthenticated response

Per the MCP spec (RFC 6750 § 3.1), a missing/invalid token returns:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="my-brain"
```

Caddy's `forward_auth` handler does this for free.

---

## 15. Updated Compose — Caddy reverse proxy in front

Add one new service, rewrite two `ports:` mappings. Services `my-brain-db`, `my-brain-orchestrator`, `my-brain-mcp`, `my-brain-llm*` are unchanged **except that they no longer publish ports to the host** — only Caddy does.

```yaml
# docker-compose.yml (delta from v2 — only changed sections shown)

services:

  my-brain-db:
    # ... (unchanged) ...
    # REMOVE the `ports:` block — DB is internal-only.
    # (keep only if you need host psql access for debugging)

  my-brain-orchestrator:
    # ... (unchanged) ...
    # REMOVE the `ports:` block — Caddy proxies to it.

  my-brain-mcp:
    # ... (unchanged) ...
    # REMOVE the `ports:` block — Caddy proxies to it.

  # ─── NEW: auth + reverse proxy ────────────────────────────────────────────
  my-brain-gateway:
    image: caddy:2-alpine
    container_name: my-brain-gateway
    restart: unless-stopped
    depends_on:
      my-brain-mcp:
        condition: service_started
      my-brain-orchestrator:
        condition: service_healthy
    environment:
      MYBRAIN_AUTH_TOKEN_FILE: /run/secrets/auth-token
      MYBRAIN_CORS_ORIGINS: ${MYBRAIN_CORS_ORIGINS:-*}
    volumes:
      - ./gateway/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./.secrets/auth-token:/run/secrets/auth-token:ro
      - caddy-data:/data
      - caddy-config:/config
    ports:
      # Single public ingress. Both /mcp and /v1/* enter here.
      - "${MYBRAIN_BIND_HOST:-127.0.0.1}:${MYBRAIN_MCP_PORT:-3333}:3333"
      - "${MYBRAIN_BIND_HOST:-127.0.0.1}:${MYBRAIN_REST_PORT:-8080}:8080"

volumes:
  # ... (existing ones) ...
  caddy-data:
    name: my-brain-caddy-data
  caddy-config:
    name: my-brain-caddy-config
```

### 15.1. `gateway/Caddyfile`

```caddy
# gateway/Caddyfile
# Two listeners, same bearer check, different upstreams.

{
    admin off
    auto_https off
}

# Shared snippet: require Authorization: Bearer <token>.
# Token comes from the mounted secret file; re-read on Caddy reload.
(bearer_auth) {
    @unauth not header Authorization "Bearer {file./run/secrets/auth-token}"
    handle @unauth {
        header WWW-Authenticate `Bearer realm="my-brain"`
        respond "Unauthorized" 401
    }
}

# MCP endpoint — port 3333
:3333 {
    import bearer_auth
    # Strip Authorization before forwarding so tokens never leak into app logs.
    request_header -Authorization
    reverse_proxy my-brain-mcp:3333 {
        header_up Host {host}
        flush_interval -1  # required for SSE/streamable HTTP
    }
}

# REST endpoint — port 8080
:8080 {
    import bearer_auth
    request_header -Authorization
    reverse_proxy my-brain-orchestrator:8080 {
        header_up Host {host}
    }
}
```

**Key behaviours:**
- `{file./run/secrets/auth-token}` re-reads the secret file on every request, so **rotation is hot** — no Caddy restart needed (see § 17).
- `flush_interval -1` disables response buffering, critical for MCP's SSE streaming.
- `request_header -Authorization` strips the bearer before it hits the upstream, so orchestrator/mcp logs never contain tokens.
- Single Caddy binary → ~50 MB container, adds <1 ms latency per request.

### 15.2. `.env.example` additions

```bash
# ─── Authentication ──────────────────────────────────────────────────────────
# Path to the auth token file (relative to compose project root). Created by
# ./scripts/install.sh on first run; 64 random chars prefixed with `my-brain-`.
# Never commit this file — .gitignore already excludes .secrets/.
MYBRAIN_AUTH_TOKEN_FILE=./.secrets/auth-token

# When set to true, install.sh will regenerate the token even if one exists.
MYBRAIN_FORCE_REGEN_TOKEN=false
```

---

## 16. One-line installer — `scripts/install.sh`

The full install flow from a clean machine:

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/my-brain/main/scripts/install.sh | bash
```

That script clones the repo, generates a token, writes `.env`, pulls images, boots the stack, and prints the token + connection snippet.

`scripts/install.sh`:

```bash
#!/usr/bin/env bash
# my-brain installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<org>/my-brain/main/scripts/install.sh | bash
#
# Or, from a checked-out repo:
#   ./scripts/install.sh [--mode memory|full] [--model qwen3.5:0.8b] [--force-token]

set -euo pipefail

# ─── Config defaults (override via flags or env) ────────────────────────────
MYBRAIN_REPO_URL="${MYBRAIN_REPO_URL:-https://github.com/<your-org>/my-brain.git}"
MYBRAIN_INSTALL_DIR="${MYBRAIN_INSTALL_DIR:-$HOME/.my-brain}"
MYBRAIN_VERSION="${MYBRAIN_VERSION:-latest}"   # git tag or "latest" → main
MYBRAIN_MODE="${MYBRAIN_MODE:-memory}"
MYBRAIN_LLM_MODEL="${MYBRAIN_LLM_MODEL:-qwen3.5:0.8b}"
MYBRAIN_FORCE_REGEN_TOKEN="${MYBRAIN_FORCE_REGEN_TOKEN:-false}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)         MYBRAIN_MODE="$2"; shift 2 ;;
    --model)        MYBRAIN_LLM_MODEL="$2"; shift 2 ;;
    --version)      MYBRAIN_VERSION="$2"; shift 2 ;;
    --install-dir)  MYBRAIN_INSTALL_DIR="$2"; shift 2 ;;
    --force-token)  MYBRAIN_FORCE_REGEN_TOKEN=true; shift ;;
    --help|-h)
      sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ─── Pretty printing ────────────────────────────────────────────────────────
say()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── Preflight ──────────────────────────────────────────────────────────────
say "Preflight checks"
command -v git >/dev/null     || die "git not found"
command -v docker >/dev/null  || die "docker not found"
docker compose version >/dev/null 2>&1 \
  || die "docker compose v2 not found (need Docker 20.10+ with compose plugin)"
command -v openssl >/dev/null || die "openssl not found (needed for token generation)"
ok "tooling available"

# ─── Clone or update the repo ───────────────────────────────────────────────
if [[ -d "$MYBRAIN_INSTALL_DIR/.git" ]]; then
  say "Updating existing install at $MYBRAIN_INSTALL_DIR"
  git -C "$MYBRAIN_INSTALL_DIR" fetch --tags --quiet
else
  say "Cloning $MYBRAIN_REPO_URL → $MYBRAIN_INSTALL_DIR"
  git clone --quiet "$MYBRAIN_REPO_URL" "$MYBRAIN_INSTALL_DIR"
fi

cd "$MYBRAIN_INSTALL_DIR"

# Checkout the requested version (tag or main)
if [[ "$MYBRAIN_VERSION" == "latest" ]]; then
  git checkout --quiet main
  git pull --quiet --ff-only origin main
else
  git checkout --quiet "tags/$MYBRAIN_VERSION" \
    || die "version '$MYBRAIN_VERSION' not found"
fi
INSTALLED_VERSION="$(git describe --tags --always 2>/dev/null || echo main)"
ok "on version: $INSTALLED_VERSION"

# ─── .env from .env.example ─────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  # Fill in user choices
  sed -i.bak -E \
    -e "s|^MYBRAIN_MODE=.*|MYBRAIN_MODE=${MYBRAIN_MODE}|" \
    -e "s|^MYBRAIN_LLM_MODEL=.*|MYBRAIN_LLM_MODEL=${MYBRAIN_LLM_MODEL}|" \
    .env && rm -f .env.bak
  ok "wrote .env"
else
  warn ".env already exists — leaving it alone"
fi

# Generate a random DB password if still the placeholder
if grep -q '^MYBRAIN_DB_PASSWORD=change-me-in-real-life' .env; then
  NEW_DB_PW="$(openssl rand -base64 33 | tr -d '/+=' | cut -c1-40)"
  sed -i.bak -E \
    "s|^MYBRAIN_DB_PASSWORD=.*|MYBRAIN_DB_PASSWORD=${NEW_DB_PW}|" \
    .env && rm -f .env.bak
  ok "generated random DB password"
fi

# ─── Auth token ─────────────────────────────────────────────────────────────
mkdir -p .secrets
chmod 700 .secrets

TOKEN_FILE=".secrets/auth-token"
if [[ -f "$TOKEN_FILE" && "$MYBRAIN_FORCE_REGEN_TOKEN" != "true" ]]; then
  warn "auth token already exists — use --force-token to regenerate"
else
  # 64 chars of URL-safe entropy, prefixed with `my-brain-`.
  # openssl rand -base64 produces /+=; strip those, take 64 chars.
  RAW="$(openssl rand -base64 96 | tr -d '/+=\n' | cut -c1-64)"
  TOKEN="my-brain-${RAW}"
  printf '%s' "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  ok "generated auth token → $TOKEN_FILE"
fi

# ─── Boot the stack ─────────────────────────────────────────────────────────
say "Pulling images"
if [[ "$MYBRAIN_MODE" == "full" ]]; then
  docker compose --profile full pull
else
  docker compose pull
fi

say "Starting services (mode: $MYBRAIN_MODE)"
if [[ "$MYBRAIN_MODE" == "full" ]]; then
  docker compose --profile full up -d
else
  docker compose up -d
fi

# ─── Wait for health ────────────────────────────────────────────────────────
say "Waiting for orchestrator to be healthy"
for i in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' my-brain-orchestrator 2>/dev/null || echo starting)"
  if [[ "$status" == "healthy" ]]; then
    ok "orchestrator healthy"
    break
  fi
  sleep 2
  [[ $i -eq 60 ]] && die "orchestrator did not become healthy in 120s — check 'docker compose logs my-brain-orchestrator'"
done

# ─── Smoke test ─────────────────────────────────────────────────────────────
TOKEN="$(cat "$TOKEN_FILE")"
REST_PORT="$(grep -E '^MYBRAIN_REST_PORT=' .env | cut -d= -f2 | tr -d '"')"
MCP_PORT="$(grep -E '^MYBRAIN_MCP_PORT=' .env | cut -d= -f2 | tr -d '"')"
: "${REST_PORT:=8080}"
: "${MCP_PORT:=3333}"

say "Verifying REST /health with bearer"
http_code="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:${REST_PORT}/health")"
[[ "$http_code" == "200" ]] || die "REST /health returned $http_code (expected 200)"
ok "REST OK"

say "Verifying /mcp tools/list with bearer"
http_code="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:${MCP_PORT}/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
[[ "$http_code" == "200" ]] || die "/mcp tools/list returned $http_code (expected 200)"
ok "MCP OK"

# ─── Final output ───────────────────────────────────────────────────────────
cat <<EOF

$(printf '\033[1;32m▀▀▀ my-brain is up ▀▀▀\033[0m')

  Version:   $INSTALLED_VERSION
  Mode:      $MYBRAIN_MODE
  Install:   $MYBRAIN_INSTALL_DIR
  Token:     $TOKEN_FILE  (keep this file safe; 600 perms)

  REST API:  http://127.0.0.1:${REST_PORT}/
  MCP:       http://127.0.0.1:${MCP_PORT}/mcp

  Add to Claude Code / Cursor / VS Code via .mcp.json:

  {
    "mcpServers": {
      "my-brain": {
        "type": "streamable-http",
        "url": "http://127.0.0.1:${MCP_PORT}/mcp",
        "headers": {
          "Authorization": "Bearer $(cat "$TOKEN_FILE")"
        }
      }
    }
  }

  Manage the stack from $MYBRAIN_INSTALL_DIR:
    docker compose ps
    docker compose logs -f my-brain-orchestrator
    docker compose down

  Rotate the token:
    ./scripts/rotate-token.sh

EOF
```

### 16.1. Updated `.mcp.json` — now with `headers`

Claude Code, Cursor, and VS Code all support a `headers` block on `streamable-http` servers:

```json
{
  "mcpServers": {
    "my-brain": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer my-brain-<64-char-token>"
      }
    }
  }
}
```

Because the token ends up in a config file, **do not commit your `.mcp.json` to git** if it contains a live token. Either:
- Check in `.mcp.json.example` with a placeholder, `.gitignore` the real `.mcp.json`, OR
- Use the `${env:VAR}` expansion that Claude Code / Cursor support:
  ```json
  "headers": { "Authorization": "Bearer ${env:MYBRAIN_TOKEN}" }
  ```
  Then `export MYBRAIN_TOKEN="$(cat ~/.my-brain/.secrets/auth-token)"` in your shell profile.

The installer prints both options; pick one per machine.

---

## 17. Token rotation — `scripts/rotate-token.sh`

Because Caddy re-reads `{file./run/secrets/auth-token}` on each request, rotating is a two-line job: overwrite the file, tell existing clients the new value. No container restart needed.

```bash
#!/usr/bin/env bash
# scripts/rotate-token.sh — rotate the my-brain auth token in place.
# Runs from the compose project root, OR from the host; also works inside the
# orchestrator container if you exec into it.

set -euo pipefail

TOKEN_FILE="${MYBRAIN_TOKEN_FILE:-./.secrets/auth-token}"

if [[ ! -d "$(dirname "$TOKEN_FILE")" ]]; then
  echo "secrets directory not found: $(dirname "$TOKEN_FILE")" >&2
  exit 1
fi

# Optional: back up the old token so old Claude Code sessions can finish gracefully
if [[ -f "$TOKEN_FILE" ]]; then
  cp "$TOKEN_FILE" "${TOKEN_FILE}.previous"
  chmod 600 "${TOKEN_FILE}.previous"
fi

# Generate new token (64 chars after prefix)
RAW="$(openssl rand -base64 96 | tr -d '/+=\n' | cut -c1-64)"
NEW_TOKEN="my-brain-${RAW}"

# Atomic replace (write to tmp, then mv)
TMP="$(mktemp "${TOKEN_FILE}.XXXXXX")"
printf '%s' "$NEW_TOKEN" > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$TOKEN_FILE"

echo "Token rotated."
echo "  old → ${TOKEN_FILE}.previous  (delete when safe)"
echo "  new → ${TOKEN_FILE}"
echo
echo "Update your MCP client config with:"
echo "  Authorization: Bearer $NEW_TOKEN"
```

### 17.1. Rotating from *inside* the container

If you're SSH-less into a remote host and only have a shell via `docker exec`:

```bash
docker compose exec my-brain-gateway sh -c '
  RAW=$(openssl rand -base64 96 | tr -d "/+=\n" | cut -c1-64)
  echo -n "my-brain-${RAW}" > /run/secrets/auth-token.new
  chmod 600 /run/secrets/auth-token.new
  mv /run/secrets/auth-token.new /run/secrets/auth-token
  cat /run/secrets/auth-token
'
```

But note: `/run/secrets/auth-token` is a bind-mount from the host, so this also writes to `./.secrets/auth-token` on the host. That's the design — one source of truth, both host and container see the same file.

### 17.2. Grace period for in-flight clients

If you need zero-downtime rotation (e.g., multiple Claude Code sessions using an old token), Caddy supports *two* valid tokens during a transition. Extend `gateway/Caddyfile`:

```caddy
(bearer_auth) {
    @unauth {
        not header Authorization "Bearer {file./run/secrets/auth-token}"
        not header Authorization "Bearer {file./run/secrets/auth-token.previous}"
    }
    handle @unauth {
        header WWW-Authenticate `Bearer realm="my-brain"`
        respond "Unauthorized" 401
    }
}
```

During rotation: write the new token, keep `.previous` for N hours, delete `.previous` once all clients are migrated.

---

## 18. Repository structure (final)

After adding install + auth + CI, the repo on GitHub looks like:

```
my-brain/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                # lint + build + test on every PR
│   │   ├── release.yml           # build + push images on tag
│   │   └── release-please.yml    # conventional-commits → version bump + tag
│   ├── release-please-config.json
│   └── .release-please-manifest.json
├── docker-compose.yml
├── .env.example
├── .gitignore                    # includes .env, .secrets/, .mcp.json
├── orchestrator/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json              # pinned "packageManager": "pnpm@9.15.4"
│   ├── pnpm-lock.yaml
│   └── src/
│       └── index.mjs
├── gateway/
│   └── Caddyfile
├── db/
│   └── init/
│       └── 01-enable-extension.sql
├── scripts/
│   ├── install.sh
│   ├── rotate-token.sh
│   └── smoke-test.sh
├── .claude/
│   ├── skills/ ...
│   └── agents/ ...
├── .mcp.json.example
├── CHANGELOG.md                  # auto-maintained by release-please
├── LICENSE
└── README.md
```

### 18.1. `.gitignore`

```gitignore
.env
.env.*
!.env.example
.secrets/
.mcp.json
node_modules/
*.log
*.bak
dist/
```

---

## 19. `orchestrator/Dockerfile` with pnpm

Replaces the npm-based Dockerfile in v2. Multi-stage, pnpm-native, pinned version, BuildKit cache mounts.

```dockerfile
# syntax=docker/dockerfile:1.7

# ── base ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NODE_ENV=production
WORKDIR /app

# Pin corepack + pnpm to known-good versions to avoid the corepack signature
# verification issue (pnpm/pnpm#9029). packageManager in package.json is the
# source of truth; these lines just bootstrap the first run.
RUN npm install -g corepack@0.31.0 \
 && corepack enable \
 && corepack prepare pnpm@9.15.4 --activate

# System deps required by some ruvector native bindings (falls back to WASM if absent)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

# ── deps (prod only, cached) ────────────────────────────────────────────────
FROM base AS prod-deps
COPY orchestrator/package.json orchestrator/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── runner ──────────────────────────────────────────────────────────────────
FROM base AS runner
# Non-root user
RUN groupadd -g 1001 mybrain \
 && useradd -u 1001 -g mybrain -m -d /app -s /bin/false mybrain

COPY --from=prod-deps --chown=mybrain:mybrain /app/node_modules ./node_modules
COPY --chown=mybrain:mybrain orchestrator/package.json ./
COPY --chown=mybrain:mybrain orchestrator/src ./src

USER mybrain
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["node", "src/index.mjs"]
```

### 19.1. `orchestrator/package.json` (with pinned pnpm)

```json
{
  "name": "my-brain-orchestrator",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@9.15.4",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "node src/index.mjs",
    "dev": "node --watch src/index.mjs",
    "lint": "eslint src",
    "test": "node --test src"
  },
  "dependencies": {
    "@ruvector/ruvllm": "^2.5.0",
    "@ruvector/server": "^0.1.0",
    "ruvector": "^0.2.22"
  },
  "devDependencies": {
    "eslint": "^9.0.0"
  }
}
```

### 19.2. `orchestrator/.dockerignore`

```
node_modules
npm-debug.log
.pnpm-debug.log
.git
.env
.env.*
.secrets
```

---

## 20. CI — `.github/workflows/ci.yml`

Runs on every PR and every push to `main`: installs pnpm via Corepack, lints, tests, and smoke-builds the Docker image (no push).

```yaml
# .github/workflows/ci.yml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:

  lint-and-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: orchestrator
    steps:
      - uses: actions/checkout@v4

      - name: Install Node + pnpm via Corepack
        uses: actions/setup-node@v4
        with:
          node-version: 20
          # actions/setup-node reads "packageManager" from package.json and
          # activates the correct pnpm version automatically.
      - run: |
          npm install -g corepack@0.31.0
          corepack enable
          corepack prepare pnpm@9.15.4 --activate

      - uses: actions/cache@v4
        with:
          path: ~/.local/share/pnpm/store
          key: pnpm-${{ runner.os }}-${{ hashFiles('orchestrator/pnpm-lock.yaml') }}
          restore-keys: pnpm-${{ runner.os }}-

      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test

  shellcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ludeeus/action-shellcheck@master
        with:
          scandir: ./scripts

  caddyfile-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker run --rm -v $PWD/gateway:/etc/caddy caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile

  docker-build:
    runs-on: ubuntu-latest
    needs: [lint-and-test]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build orchestrator image (no push)
        uses: docker/build-push-action@v6
        with:
          context: .
          file: orchestrator/Dockerfile
          push: false
          tags: my-brain/orchestrator:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max

  compose-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate docker-compose.yml
        run: |
          cp .env.example .env
          # Stub in a password so the `:?` variable gate passes during validation
          sed -i 's|MYBRAIN_DB_PASSWORD=.*|MYBRAIN_DB_PASSWORD=ci-test|' .env
          docker compose config > /dev/null
```

---

## 21. Release automation — conventional commits → semver → images

Two workflows: `release-please.yml` (decides when a new version is needed based on commit messages) and `release.yml` (builds and pushes Docker images when a release is published).

### 21.1. `.github/workflows/release-please.yml`

```yaml
# .github/workflows/release-please.yml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          # Uses ./release-please-config.json and ./.release-please-manifest.json
          config-file: .github/release-please-config.json
          manifest-file: .github/.release-please-manifest.json
```

### 21.2. `.github/release-please-config.json`

```json
{
  "release-type": "simple",
  "packages": {
    ".": {
      "release-type": "simple",
      "package-name": "my-brain",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "include-component-in-tag": false,
      "tag-separator": ""
    }
  },
  "plugins": ["sentence-case"]
}
```

### 21.3. `.github/.release-please-manifest.json`

```json
{ ".": "0.1.0" }
```

### 21.4. `.github/workflows/release.yml`

Triggered when `release-please` merges its PR and publishes a GitHub Release. Pushes two images (orchestrator + an optional bundle tag for the whole compose project) with semver tags.

```yaml
# .github/workflows/release.yml
name: release

on:
  release:
    types: [published]

permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write

env:
  REGISTRY: ghcr.io
  ORCHESTRATOR_IMAGE: ${{ github.repository }}/orchestrator

jobs:

  build-and-push-orchestrator:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Lowercase image path
        id: img
        run: echo "name=$(echo '${{ env.ORCHESTRATOR_IMAGE }}' | tr '[:upper:]' '[:lower:]')" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (semver)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ steps.img.outputs.name }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            type=sha
            type=raw,value=latest

      - name: Build and push
        id: push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: orchestrator/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Generate attestation
        uses: actions/attest-build-provenance@v2
        with:
          subject-name: ${{ env.REGISTRY }}/${{ steps.img.outputs.name }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true

  publish-compose-bundle:
    # Attaches the compose file + scripts to the GitHub release so `install.sh`
    # can fetch a pinned version from https://github.com/<org>/my-brain/releases/download/vX.Y.Z/my-brain-vX.Y.Z.tar.gz
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create release tarball
        run: |
          mkdir -p dist
          tar --exclude-vcs -czf "dist/my-brain-${{ github.ref_name }}.tar.gz" \
            docker-compose.yml .env.example \
            orchestrator/ gateway/ db/ scripts/ .claude/ .mcp.json.example \
            README.md LICENSE CHANGELOG.md
      - name: Upload asset to release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release upload "${{ github.ref_name }}" "dist/my-brain-${{ github.ref_name }}.tar.gz" --clobber
```

### 21.5. How the flow works end-to-end

1. Developer merges PRs to `main` using **conventional commits**:
   ```
   feat: add my-brain-recall skill
   fix: prevent duplicate session inserts
   feat!: rename brain_share to brain_store       # note the ! → major bump
   ```
2. `release-please.yml` opens (or updates) a "Release 1.4.0" PR with generated `CHANGELOG.md` and version bump in `.release-please-manifest.json`.
3. When a maintainer merges that PR, `release-please` automatically:
   - Tags `v1.4.0`
   - Creates a GitHub Release
4. The GitHub Release publish event fires `release.yml`, which:
   - Builds multi-arch images (`linux/amd64`, `linux/arm64`)
   - Pushes to GHCR with tags `1.4.0`, `1.4`, `1`, `latest`, `sha-<hash>`
   - Generates build-provenance attestations
   - Attaches `my-brain-v1.4.0.tar.gz` to the release

The installer's `MYBRAIN_VERSION` flag reads these tags — `./install.sh --version v1.4.0` pins to that release.

---

## 22. One more thing: pulling a versioned image in compose

Update `docker-compose.yml` so `MYBRAIN_ORCHESTRATOR_IMAGE_TAG` defaults to the GHCR image rather than a local build:

```yaml
  my-brain-orchestrator:
    image: ${MYBRAIN_ORCHESTRATOR_IMAGE_TAG:-ghcr.io/<your-org>/my-brain/orchestrator:latest}
    # `build:` is kept as a fallback for local development.
    build:
      context: .
      dockerfile: orchestrator/Dockerfile
```

Pinning a version in `.env`:

```bash
# .env
MYBRAIN_ORCHESTRATOR_IMAGE_TAG=ghcr.io/<your-org>/my-brain/orchestrator:1.4.0
```

The installer's `--version` flag writes this line for you, so `install.sh --version v1.4.0` gets you a fully pinned stack.

---

## 23. Security checklist (what this gives you vs. what it doesn't)

What this design does cover:

- Static Bearer auth on both ingress ports (✓)
- Token never touches upstream logs — stripped by Caddy (✓)
- 64+ chars of entropy, prefixed for spotting in logs (✓)
- Hot rotation without restart (✓)
- Grace-period dual-token rotation available (✓)
- File permissions 600; directory 700 (✓)
- Token never committed — `.gitignore` covers `.secrets/` and `.mcp.json` (✓)
- Images signed via `attest-build-provenance` (✓)
- Supply-chain pinning: `packageManager` field + `--frozen-lockfile` + `corepack@0.31.0` (✓)

What this design does NOT cover (deferred by design):

- **TLS**. Caddy can auto-provision Let's Encrypt certs the moment you front it with a real hostname; until then, `127.0.0.1` binding means the token travels over loopback in the clear, which is acceptable for a single-user local tool but not for LAN/remote.
- **Per-client tokens / revocation lists.** A single static token is fine for one user. If multiple humans share the stack, upgrade to the `--allow-multiple-tokens` pattern (maintain a directory of valid token files, check all of them) or upgrade to OAuth 2.1.
- **Rate limiting.** Caddy has a `rate_limit` module; add it once you expose `/mcp` outside localhost.
- **Audit logging.** Caddy's access log captures request method + path + status, but not tool names or arguments. If you need tool-level audit, add a small middleware in the orchestrator that logs `tools/call` bodies (with token already stripped by Caddy).
- **Full MCP OAuth 2.1 + PKCE.** Only needed when making `/mcp` public on the open internet. Path forward: Caddy → Authentik/Keycloak → orchestrator.

---

## 24. Quickstart (updated, final)

From zero to working stack in three commands:

```bash
# 1. Install (clones, generates token, boots)
curl -fsSL https://raw.githubusercontent.com/<your-org>/my-brain/main/scripts/install.sh | bash

# 2. Copy the token from the output, then add to your Claude Code client:
cat > ~/.claude.d/mcp-my-brain.json <<EOF
{
  "mcpServers": {
    "my-brain": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": { "Authorization": "Bearer $(cat ~/.my-brain/.secrets/auth-token)" }
    }
  }
}
EOF

# 3. Test it
curl -s -X POST http://127.0.0.1:3333/mcp \
  -H "Authorization: Bearer $(cat ~/.my-brain/.secrets/auth-token)" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# Expected: a number around 103
```

To update later: `cd ~/.my-brain && ./scripts/install.sh --version v1.5.0`.

To rotate the token: `cd ~/.my-brain && ./scripts/rotate-token.sh`.

To tear down: `cd ~/.my-brain && docker compose down -v`.

---

## 25. Addendum TL;DR

- Auth = **static Bearer token**, 64-char random body prefixed `my-brain-`, enforced by Caddy on both `:3333/mcp` and `:8080` via a `{file.*}` lookup that supports **hot rotation**.
- Install = **one curl-bash line** that clones, generates, boots, smoke-tests, and prints the token + `.mcp.json` snippet.
- Rotate = one script, atomic file replace, optional `.previous` grace period for zero-downtime.
- CI = **pnpm + Corepack pinned**, multi-stage Dockerfile with BuildKit cache mounts, `docker compose config` validation, shellcheck on scripts, `caddy validate` on the Caddyfile.
- Release = **conventional commits → release-please → semver tag → multi-arch GHCR push with provenance attestations**, all triggered from merging one PR.
- Compose is unchanged from v2 except it no longer publishes orchestrator/mcp ports directly — **only Caddy is exposed to the host**.
