#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="${MYBRAIN_TOKEN_FILE:-./.secrets/auth-token}"
MCP_URL="${MYBRAIN_MCP_URL:-http://127.0.0.1:3333/mcp}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "token file not found: $TOKEN_FILE" >&2
  exit 1
fi

token="$(cat "$TOKEN_FILE")"
if [[ -z "$token" ]]; then
  echo "token file is empty: $TOKEN_FILE" >&2
  exit 1
fi

tmp_headers="$(mktemp)"
tmp_init="$(mktemp)"
tmp_tools="$(mktemp)"
tmp_referenced="$(mktemp)"
tmp_live="$(mktemp)"
trap 'rm -f "$tmp_headers" "$tmp_init" "$tmp_tools" "$tmp_referenced" "$tmp_live"' EXIT

curl -sS \
  -D "$tmp_headers" \
  -o "$tmp_init" \
  -X POST \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"tool-id-validator","version":"1.0.0"}}}' \
  "$MCP_URL"

session_id="$(awk 'BEGIN{IGNORECASE=1} /^Mcp-Session-Id:/ {gsub("\r","",$2); print $2}' "$tmp_headers" | tail -n 1)"
if [[ -z "$session_id" ]]; then
  echo "missing Mcp-Session-Id from initialize response" >&2
  cat "$tmp_init" >&2
  exit 1
fi

curl -sS \
  -o "$tmp_tools" \
  -X POST \
  -H "Authorization: Bearer $token" \
  -H "Mcp-Session-Id: $session_id" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  "$MCP_URL"

# `node - <arg>` shifts first user arg to process.argv[2], so read JSON from argv[2].
node - "$tmp_tools" <<'NODE' | sort -u > "$tmp_live"
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const tools = data?.result?.tools ?? [];
for (const tool of tools) {
  if (tool?.name) {
    process.stdout.write(`${tool.name}\n`);
  }
}
NODE

grep -Rho "mcp__my-brain__[a-zA-Z0-9_]*" .claude \
  | sed 's/^mcp__my-brain__//' \
  | sort -u > "$tmp_referenced"

missing="$(comm -23 "$tmp_referenced" "$tmp_live" || true)"
if [[ -n "$missing" ]]; then
  echo "invalid tool references found in .claude files:" >&2
  echo "$missing" >&2
  exit 1
fi

echo "tool-id validation passed"
