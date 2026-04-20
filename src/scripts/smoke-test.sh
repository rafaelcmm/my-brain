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
: "${rest_port:=8080}"
: "${mcp_port:=3333}"

# Enforce least-privilege secret file modes before probing network paths.
if find .secrets -type d ! -perm 700 | grep -q .; then
  echo "invalid .secrets directory permissions" >&2
  exit 1
fi
if find .secrets -type f ! -perm 600 | grep -q .; then
  echo "invalid .secrets file permissions" >&2
  exit 1
fi

unauth_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${rest_port}/health")"
[[ "$unauth_code" == "401" ]] || { echo "expected 401 without token, got $unauth_code" >&2; exit 1; }

auth_code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "http://127.0.0.1:${rest_port}/health")"
[[ "$auth_code" == "200" ]] || { echo "expected 200 with token, got $auth_code" >&2; exit 1; }

# Streamable HTTP transport: POST an MCP initialize message and expect 200.
# The gateway enforces bearer auth before forwarding; a 200 confirms both
# auth pass-through and mcp-proxy reachability on the /mcp endpoint.
mcp_code="$(curl --max-time 5 -s -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}' \
  "http://127.0.0.1:${mcp_port}/mcp" || true)"
[[ "$mcp_code" == "200" ]] || { echo "expected 200 /mcp, got $mcp_code" >&2; exit 1; }

echo "smoke test passed"
