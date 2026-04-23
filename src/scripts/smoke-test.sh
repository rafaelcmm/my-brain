#!/usr/bin/env bash
# Validate running stack auth and health behavior.

set -euo pipefail

ENV_FILE="${MYBRAIN_ENV_FILE:-.env}"
TOKEN_FILE="${MYBRAIN_TOKEN_FILE:-./.secrets/auth-token}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "missing token file: $TOKEN_FILE" >&2
  exit 1
fi

token="$(cat "$TOKEN_FILE")"
rest_port="$(grep -E '^MYBRAIN_REST_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
mcp_port="$(grep -E '^MYBRAIN_MCP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
web_port="$(grep -E '^MYBRAIN_WEB_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
: "${rest_port:=8080}"
: "${mcp_port:=3333}"
: "${web_port:=3000}"

# Enforce least-privilege secret file modes before probing network paths.
if find .secrets -type d ! -perm 700 | grep -q .; then
  echo "invalid .secrets directory permissions" >&2
  exit 1
fi
if find .secrets -type f ! -perm 600 | grep -q .; then
  echo "invalid .secrets file permissions" >&2
  exit 1
fi

retry_until_code() {
  local expected_code="$1"
  local label="$2"
  shift 2
  local observed_code="000"

  for _ in $(seq 1 12); do
    observed_code="$("$@" || true)"
    if [[ "$observed_code" == "$expected_code" ]]; then
      return 0
    fi
    sleep 2
  done

  echo "expected ${expected_code} ${label}, got ${observed_code}" >&2
  return 1
}

retry_until_code "401" "GET /health without token" \
  curl --max-time 5 -s -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:${rest_port}/health"

retry_until_code "200" "GET /health with token" \
  curl --max-time 5 -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $token" \
  "http://127.0.0.1:${rest_port}/health"

# Streamable HTTP transport: POST an MCP initialize message and expect 200.
# The gateway enforces bearer auth before forwarding; a 200 confirms both
# auth pass-through and mcp-proxy reachability on the /mcp endpoint.
# Retry initialize because gateway and bridge can report healthy slightly
# before first /mcp transaction path is fully accepting requests.
mcp_code="000"
for _ in $(seq 1 12); do
  mcp_code="$(curl --max-time 5 -s -o /dev/null -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}' \
    "http://127.0.0.1:${mcp_port}/mcp" || true)"
  if [[ "$mcp_code" == "200" ]]; then
    break
  fi
  sleep 2
done
[[ "$mcp_code" == "200" ]] || { echo "expected 200 /mcp, got $mcp_code" >&2; exit 1; }

# The public gateway should reject the legacy SSE transport so client tooling
# converges on one supported MCP contract instead of two partially-compatible ones.
retry_until_code "410" "GET /sse with token" \
  curl --max-time 5 -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $token" \
  "http://127.0.0.1:${mcp_port}/sse"

# Validate web login flow and protected dashboard reachability.
cookie_jar="$(mktemp)"
trap 'rm -f "$cookie_jar"' EXIT

login_code="$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' \
  -c "$cookie_jar" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"${token}\"}" \
  "http://127.0.0.1:${web_port}/api/auth/login" || true)"
[[ "$login_code" == "200" ]] || { echo "expected 200 web login, got $login_code" >&2; exit 1; }

dashboard_code="$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' \
  -b "$cookie_jar" \
  "http://127.0.0.1:${web_port}/dashboard" || true)"
# In production mode the session cookie is secure-only; local HTTP probes can
# receive a redirect when the cookie is intentionally withheld by the client.
[[ "$dashboard_code" == "200" || "$dashboard_code" == "307" ]] || {
  echo "expected 200/307 dashboard, got $dashboard_code" >&2
  exit 1
}

echo "smoke test passed"
