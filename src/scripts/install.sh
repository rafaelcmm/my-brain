#!/usr/bin/env bash
# my-brain installer.
#
# Recommended safe flow:
#   curl -fsSL <install-url> -o install.sh
#   less install.sh
#   bash install.sh
#
# Direct flow (trusted source only):
#   curl -fsSL <install-url> | bash

set -euo pipefail

MYBRAIN_REPO_URL="${MYBRAIN_REPO_URL:-https://github.com/<your-org>/my-brain.git}"
MYBRAIN_INSTALL_DIR="${MYBRAIN_INSTALL_DIR:-$HOME/.my-brain}"
MYBRAIN_VERSION="${MYBRAIN_VERSION:-latest}"
MYBRAIN_MODE="${MYBRAIN_MODE:-memory}"
MYBRAIN_LLM_MODEL="${MYBRAIN_LLM_MODEL:-qwen3.5:0.8b}"
MYBRAIN_FORCE_REGEN_TOKEN="${MYBRAIN_FORCE_REGEN_TOKEN:-false}"
MYBRAIN_VERIFY_SHA256="${MYBRAIN_VERIFY_SHA256:-}"

say() { printf '>> %s\n' "$*"; }
ok() { printf 'OK %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; }
die() { printf 'ERR %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  ./src/scripts/install.sh [--mode memory|full] [--model MODEL] [--version TAG]
                       [--install-dir PATH] [--force-token]

Optional integrity check:
  MYBRAIN_VERIFY_SHA256=<expected_hash> ./src/scripts/install.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MYBRAIN_MODE="$2"
      shift 2
      ;;
    --model)
      MYBRAIN_LLM_MODEL="$2"
      shift 2
      ;;
    --version)
      MYBRAIN_VERSION="$2"
      shift 2
      ;;
    --install-dir)
      MYBRAIN_INSTALL_DIR="$2"
      shift 2
      ;;
    --force-token)
      MYBRAIN_FORCE_REGEN_TOKEN=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown flag: $1"
      ;;
  esac
done

if [[ -n "$MYBRAIN_VERIFY_SHA256" ]]; then
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    actual_hash="$(sha256sum "${BASH_SOURCE[0]}" | awk '{print $1}')"
    [[ "$actual_hash" == "$MYBRAIN_VERIFY_SHA256" ]] || die "Installer checksum mismatch"
    ok "installer checksum verified"
  else
    warn "checksum verification skipped (script source file not available)"
  fi
fi

say "Preflight checks"
command -v git >/dev/null || die "git not found"
command -v docker >/dev/null || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose v2 required"
command -v openssl >/dev/null || die "openssl not found"
command -v curl >/dev/null || die "curl not found"
ok "tooling available"

if [[ -d "$MYBRAIN_INSTALL_DIR/.git" ]]; then
  say "Updating existing install at $MYBRAIN_INSTALL_DIR"
  git -C "$MYBRAIN_INSTALL_DIR" fetch --tags --quiet
else
  say "Cloning $MYBRAIN_REPO_URL -> $MYBRAIN_INSTALL_DIR"
  git clone --quiet "$MYBRAIN_REPO_URL" "$MYBRAIN_INSTALL_DIR"
fi

cd "$MYBRAIN_INSTALL_DIR"

if [[ "$MYBRAIN_VERSION" == "latest" ]]; then
  git checkout --quiet main
  git pull --quiet --ff-only origin main
else
  git checkout --quiet "tags/$MYBRAIN_VERSION" || die "Version not found: $MYBRAIN_VERSION"
fi

installed_version="$(git describe --tags --always 2>/dev/null || echo main)"
ok "version: $installed_version"

if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i.bak -E \
    -e "s|^MYBRAIN_MODE=.*|MYBRAIN_MODE=${MYBRAIN_MODE}|" \
    -e "s|^MYBRAIN_LLM_MODEL=.*|MYBRAIN_LLM_MODEL=${MYBRAIN_LLM_MODEL}|" \
    .env
  rm -f .env.bak
  ok "wrote .env"
else
  warn ".env exists; preserving"
fi

if grep -q '^MYBRAIN_DB_PASSWORD=change-me-in-real-life' .env; then
  new_db_pw="$(openssl rand -base64 33 | tr -d '/+=\n' | cut -c1-40)"
  sed -i.bak -E "s|^MYBRAIN_DB_PASSWORD=.*|MYBRAIN_DB_PASSWORD=${new_db_pw}|" .env
  rm -f .env.bak
  ok "generated DB password"
fi

mkdir -p .secrets
chmod 700 .secrets

token_file=".secrets/auth-token"
if [[ -f "$token_file" && "$MYBRAIN_FORCE_REGEN_TOKEN" != "true" ]]; then
  warn "auth token exists; use --force-token to rotate"
else
  raw="$(openssl rand -base64 96 | tr -d '/+=\n' | cut -c1-64)"
  token="my-brain-${raw}"
  printf '%s' "$token" > "$token_file"
  chmod 600 "$token_file"
  ok "generated auth token"
fi

token="$(cat "$token_file")"

# Render gateway token matcher in Caddyfile.
sed -i.bak -E "s|Bearer [^\"]+|Bearer ${token}|" src/gateway/Caddyfile
rm -f src/gateway/Caddyfile.bak

if [[ ! -f .secrets/auth-token.previous ]]; then
  printf 'unused-placeholder' > .secrets/auth-token.previous
  chmod 600 .secrets/auth-token.previous
fi

token_perms="$(stat -c '%a' "$token_file" 2>/dev/null || stat -f '%A' "$token_file")"
[[ "$token_perms" == "600" ]] || die "bad token perms: $token_perms"

say "Pulling images"
if [[ "$MYBRAIN_MODE" == "full" ]]; then
  docker compose --profile full pull
else
  docker compose pull
fi

say "Starting services"
if [[ "$MYBRAIN_MODE" == "full" ]]; then
  docker compose --profile full up -d
else
  docker compose up -d
fi

say "Waiting for orchestrator health"
for i in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' my-brain-orchestrator 2>/dev/null || echo starting)"
  if [[ "$status" == "healthy" ]]; then
    ok "orchestrator healthy"
    break
  fi
  sleep 2
  [[ "$i" -eq 60 ]] && die "orchestrator failed to become healthy"
done

token="$(cat "$token_file")"
rest_port="$(grep -E '^MYBRAIN_REST_PORT=' .env | cut -d= -f2 | tr -d '"')"
mcp_port="$(grep -E '^MYBRAIN_MCP_PORT=' .env | cut -d= -f2 | tr -d '"')"
: "${rest_port:=8080}"
: "${mcp_port:=3333}"

say "Verifying REST health"
rest_code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "http://127.0.0.1:${rest_port}/health")"
[[ "$rest_code" == "200" ]] || die "REST /health failed with $rest_code"

say "Verifying MCP SSE endpoint"
mcp_code="$(curl --max-time 5 -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "http://127.0.0.1:${mcp_port}/sse" || true)"
[[ "$mcp_code" == "200" ]] || die "MCP /sse failed with $mcp_code"

cat <<EOF

my-brain ready

Version: $installed_version
Mode: $MYBRAIN_MODE
Install dir: $MYBRAIN_INSTALL_DIR
Token file: $token_file

REST: http://127.0.0.1:${rest_port}
MCP:  http://127.0.0.1:${mcp_port}/sse

Client snippet (.mcp.json):
{
  "mcpServers": {
    "my-brain": {
      "type": "sse",
      "url": "http://127.0.0.1:${mcp_port}/sse",
      "headers": {
        "Authorization": "Bearer $token"
      }
    }
  }
}

Manage:
  docker compose ps
  docker compose logs -f my-brain-orchestrator
  docker compose down

Rotate token:
  ./src/scripts/rotate-token.sh
EOF
