#!/usr/bin/env bash
# Quick security validation checklist for my-brain deployment.
# Run before production deployment or after configuration changes.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { printf "${GREEN}✓${NC} %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
section() { printf "\n${YELLOW}=== %s ===${NC}\n" "$*"; }

FAILED=0

fail_check() {
  fail "$*"
  FAILED=$((FAILED + 1))
}

section "Token Security"

if [[ ! -f .secrets/auth-token ]]; then
  fail_check "auth token file missing: .secrets/auth-token"
else
  token="$(cat .secrets/auth-token)"
  token_len="${#token}"
  
  if [[ "$token_len" -lt 73 ]]; then
    fail_check "token too short: ${token_len} chars (require ≥73)"
  else
    pass "token length: ${token_len} chars"
  fi
  
  if [[ ! "$token" =~ ^my-brain- ]]; then
    fail_check "token missing required 'my-brain-' prefix"
  else
    pass "token prefix validated"
  fi
  
  token_perms="$(stat -c '%a' .secrets/auth-token 2>/dev/null || stat -f '%A' .secrets/auth-token)"
  if [[ "$token_perms" != "600" ]]; then
    fail_check "token permissions: ${token_perms} (require 600)"
  else
    pass "token permissions: 600"
  fi
fi

secrets_perms="$(stat -c '%a' .secrets 2>/dev/null || stat -f '%A' .secrets)"
if [[ "$secrets_perms" != "700" ]]; then
  fail_check ".secrets permissions: ${secrets_perms} (require 700)"
else
  pass ".secrets permissions: 700"
fi

section "Database Security"

if [[ ! -f .env ]]; then
  fail_check ".env file missing"
else
  if grep -q '^MYBRAIN_DB_PASSWORD=change-me-in-real-life' .env; then
    fail_check "default DB password detected in .env"
  else
    pass "DB password customized"
  fi
  
  db_pw="$(grep '^MYBRAIN_DB_PASSWORD=' .env | cut -d= -f2)"
  if [[ "${#db_pw}" -lt 20 ]]; then
    warn "DB password short (${#db_pw} chars); recommend ≥32"
  else
    pass "DB password length: ${#db_pw} chars"
  fi
fi

section "Internal API Key"

if [[ -f .env ]]; then
  internal_key="$(grep '^MYBRAIN_INTERNAL_API_KEY=' .env | cut -d= -f2 || true)"
  if [[ -z "$internal_key" ]]; then
    fail_check "MYBRAIN_INTERNAL_API_KEY missing or empty"
  else
    pass "internal API key configured"
  fi
fi

section "Network Binding"

if [[ -f .env ]]; then
  bind_host="$(grep '^MYBRAIN_BIND_HOST=' .env | cut -d= -f2 || echo 127.0.0.1)"
  
  if [[ "$bind_host" == "0.0.0.0" ]]; then
    warn "binding to 0.0.0.0 (all interfaces); ensure firewall configured"
  else
    pass "bind host: ${bind_host}"
  fi
fi

section "Rate Limiting Config"

if [[ -f .env ]]; then
  rate_limit="$(grep '^MYBRAIN_RATE_LIMIT_PER_MIN=' .env | cut -d= -f2 || echo 60)"
  pass "rate limit: ${rate_limit} requests/min"
  
  max_body="$(grep '^MYBRAIN_MAX_REQUEST_BODY_BYTES=' .env | cut -d= -f2 || echo 1048576)"
  max_body_mb="$((max_body / 1048576))"
  pass "max request body: ${max_body_mb}MB"
fi

section "Docker Configuration"

if ! docker compose config >/dev/null 2>&1; then
  fail_check "docker compose config validation failed"
else
  pass "docker compose config valid"
fi

if docker compose config | grep -q 'caddy.*rate_limit'; then
  pass "caddy rate_limit module configured"
else
  warn "caddy rate_limit module not detected in compose config"
fi

section "Service Health"

if docker ps --filter "name=my-brain-gateway" --filter "status=running" | grep -q my-brain-gateway; then
  pass "gateway container running"
  
  if docker exec my-brain-gateway caddy version | grep -q rate_limit 2>/dev/null; then
    pass "gateway has rate_limit module"
  else
    warn "gateway rate_limit module not detected (rebuild required)"
  fi
else
  warn "gateway container not running (checks skipped)"
fi

if docker ps --filter "name=my-brain-orchestrator" --filter "status=running" | grep -q my-brain-orchestrator; then
  pass "orchestrator container running"
  
  if docker logs my-brain-orchestrator 2>&1 | grep -q "auth token validated"; then
    pass "orchestrator validated token at startup"
  else
    warn "orchestrator startup token validation not confirmed"
  fi
else
  warn "orchestrator container not running (checks skipped)"
fi

section "Summary"

if [[ "$FAILED" -eq 0 ]]; then
  printf "\n${GREEN}All critical checks passed ✓${NC}\n"
  exit 0
else
  printf "\n${RED}${FAILED} check(s) failed ✗${NC}\n"
  printf "Fix issues above before deploying to production.\n"
  exit 1
fi
