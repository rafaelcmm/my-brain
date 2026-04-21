#!/usr/bin/env bash
# Replay key assertions from knowledge/my-brain-simulation-report-v2.md.

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
if [[ "${#token}" -lt 64 ]]; then
  echo "token length check failed: ${#token} < 64" >&2
  exit 1
fi

rest_port="$(grep -E '^MYBRAIN_REST_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
mcp_port="$(grep -E '^MYBRAIN_MCP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
metrics_port="$(grep -E '^MYBRAIN_PROMETHEUS_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
internal_key="$(grep -E '^MYBRAIN_INTERNAL_API_KEY=' "$ENV_FILE" | cut -d= -f2 | tr -d '"')"
: "${rest_port:=8080}"
: "${mcp_port:=3333}"
: "${metrics_port:=9090}"
: "${internal_key:=my-brain-internal-local-key}"

api() {
  local path="$1"
  local payload="${2:-"{}"}"
  curl --max-time 15 -sS \
    -H "Authorization: Bearer ${token}" \
    -H "content-type: application/json" \
    -X POST \
    -d "$payload" \
    "http://127.0.0.1:${rest_port}${path}"
}

api_get() {
  local path="$1"
  curl --max-time 15 -sS \
    -H "Authorization: Bearer ${token}" \
    "http://127.0.0.1:${rest_port}${path}"
}

extract_json() {
  local json="$1"
  local expr="$2"
  node -e "const d = JSON.parse(process.argv[1]); const v = (${expr}); if (typeof v === 'object') console.log(JSON.stringify(v)); else console.log(v ?? '');" "$json"
}

capabilities="$(api_get "/v1/capabilities")"
engine="$(extract_json "$capabilities" "d.capabilities?.engine")"
vector_db="$(extract_json "$capabilities" "d.capabilities?.vectorDb")"
embedding_dim="$(extract_json "$capabilities" "d.capabilities?.embeddingDim")"

if [[ "$engine" != "true" || "$vector_db" != "true" || "$embedding_dim" -lt 1024 ]]; then
  echo "capabilities check failed: engine=$engine vectorDb=$vector_db embeddingDim=$embedding_dim" >&2
  exit 1
fi

ctx="$(api "/v1/context/probe" '{"cwd":"/home/rafaelmonteiro/Workspace/my-brain","repo_hint":"github.com/rafaelcmm/my-brain","language_hint":"javascript","framework_hints":["docker","node"]}')"
source_field="$(extract_json "$ctx" "d.context?.source")"
if [[ "$source_field" == conversation:* ]]; then
  echo "context source still placeholder: $source_field" >&2
  exit 1
fi

replay_id="simreplay$(date +%s)"
content="${replay_id} In my-brain project, package manager is pnpm 9.15.4 and lockfile is pnpm-lock.yaml"
metadata='{"repo":"github.com/rafaelcmm/my-brain","repo_name":"my-brain","project":"my-brain","language":"javascript","frameworks":["docker","node"],"tags":["pnpm","package-manager"],"source":"simulation-replay-v2"}'

remember1="$(api "/v1/memory" "{\"content\":\"${content}\",\"type\":\"convention\",\"scope\":\"repo\",\"metadata\":${metadata}}")"
remember2="$(api "/v1/memory" "{\"content\":\"${content}\",\"type\":\"convention\",\"scope\":\"repo\",\"metadata\":${metadata}}")"
remember3="$(api "/v1/memory" "{\"content\":\"${content}\",\"type\":\"convention\",\"scope\":\"repo\",\"metadata\":${metadata}}")"

id1="$(extract_json "$remember1" "d.memory_id")"
id2="$(extract_json "$remember2" "d.memory_id")"
id3="$(extract_json "$remember3" "d.memory_id")"
if [[ "$id1" != "$id2" || "$id1" != "$id3" ]]; then
  echo "dedup check failed: ids differ ($id1 $id2 $id3)" >&2
  exit 1
fi

# Query with the unique replay_id token to anchor recall toward the stored entry.
# Pre-existing memories with higher use_count may still rank above a freshly-stored
# one, so we assert presence within top-5 rather than demanding strict rank1.
recall_default="$(api "/v1/memory/recall" "{\"query\":\"${replay_id} pnpm package manager\",\"top_k\":5,\"scope\":\"repo\",\"repo\":\"my-brain\",\"language\":\"javascript\"}")"
found_in_top5="$(node -e "const d=JSON.parse(process.argv[1]); const id=process.argv[2]; console.log(Array.isArray(d.results) && d.results.some((r)=>r.id===id));" "$recall_default" "$id1")"
if [[ "$found_in_top5" != "true" ]]; then
  first_id="$(extract_json "$recall_default" "d.results?.[0]?.id")"
  echo "recall ranking check failed: $id1 not in top-5 results (rank1=$first_id)" >&2
  exit 1
fi

vote_up="$(api "/v1/memory/vote" "{\"memory_id\":\"${id1}\",\"direction\":\"up\",\"reason\":\"correct recall\"}")"
vote_bias="$(extract_json "$vote_up" "d.vote_bias")"
node -e "if (!(Number(process.argv[1]) > 0)) process.exit(1)" "$vote_bias" || {
  echo "vote bias check failed: $vote_bias" >&2
  exit 1
}

forget_soft="$(api "/v1/memory/forget" "{\"memory_id\":\"${id1}\",\"mode\":\"soft\"}")"
soft_mode="$(extract_json "$forget_soft" "d.mode")"
if [[ "$soft_mode" != "soft" ]]; then
  echo "soft forget response invalid" >&2
  exit 1
fi

after_soft_default="$(api "/v1/memory/recall" "{\"query\":\"${replay_id} pnpm package manager\",\"top_k\":20,\"scope\":\"repo\",\"repo\":\"github.com/rafaelcmm/my-brain\"}")"
forgotten_present_default="$(node -e "const d=JSON.parse(process.argv[1]); const id=process.argv[2]; console.log(Array.isArray(d.results) && d.results.some((row)=>row.id===id));" "$after_soft_default" "$id1")"
if [[ "$forgotten_present_default" != "false" ]]; then
  echo "forgotten memory leaked in default recall" >&2
  exit 1
fi

after_soft_visible="$(api "/v1/memory/recall" "{\"query\":\"${replay_id} pnpm package manager\",\"top_k\":20,\"scope\":\"repo\",\"repo\":\"github.com/rafaelcmm/my-brain\",\"include_forgotten\":true}")"
forgotten_present_visible="$(node -e "const d=JSON.parse(process.argv[1]); const id=process.argv[2]; console.log(Array.isArray(d.results) && d.results.some((row)=>row.id===id));" "$after_soft_visible" "$id1")"
if [[ "$forgotten_present_visible" != "true" ]]; then
  echo "forgotten memory not visible with include_forgotten" >&2
  exit 1
fi

learning_stats="$(api_get "/v1/learning/stats")"
learning_success="$(extract_json "$learning_stats" "d.success")"
if [[ "$learning_success" != "true" ]]; then
  echo "learning stats endpoint failed" >&2
  exit 1
fi

mcp_initialize='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sim-replay","version":"1.0.0"}}}'
init_response="$(curl --max-time 15 -sS -H "Authorization: Bearer ${token}" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -X POST -d "$mcp_initialize" "http://127.0.0.1:${mcp_port}/mcp")"
if ! node -e "const d=JSON.parse(process.argv[1]); if(!d.result) process.exit(1)" "$init_response"; then
  echo "mcp initialize failed" >&2
  exit 1
fi

orchestrator_metrics="$(curl --max-time 15 -sS -H "Authorization: Bearer ${token}" "http://127.0.0.1:${rest_port}/metrics")"
for metric in mb_remember_total mb_recall_total mb_dedup_hits_total mb_forget_total; do
  if ! grep -q "^${metric}" <<<"$orchestrator_metrics"; then
    echo "missing orchestrator metric: $metric" >&2
    exit 1
  fi
done

bridge_metrics="$(curl --max-time 15 -sS -H "x-mybrain-internal-key: ${internal_key}" "http://127.0.0.1:${metrics_port}/metrics")"
if ! grep -q "^mb_bridge_tool_calls_total" <<<"$bridge_metrics"; then
  echo "missing bridge metric mb_bridge_tool_calls_total" >&2
  exit 1
fi

echo "simulation replay v2: PASS"
