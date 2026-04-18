#!/usr/bin/env bash
set -euo pipefail

# Bulk-loads Q/A interactions through MCP tools to accelerate index warm-up testing.
# Flow per item: query -> feedback, with periodic learn cycles for consolidation stats.

# Loads repository .env so script works with same runtime config used by app.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

COUNT="${COUNT:-500}"
SEED_COUNT="${SEED_COUNT:-300}"
TOP_K="${TOP_K:-5}"
QUALITY_SCORE="${QUALITY_SCORE:-0.95}"
ROUTE="${ROUTE:-qa-bulk}"
DELAY_SECONDS="${DELAY_SECONDS:-0.02}"
FORCE_LEARN_EVERY="${FORCE_LEARN_EVERY:-100}"
EXTRA_FEEDBACK_COUNT="${EXTRA_FEEDBACK_COUNT:-120}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"
# Max retries on HTTP 429 before giving up on a single call; backoff doubles each attempt.
RETRY_MAX="${RETRY_MAX:-6}"

MCP_HOST="${MCP_HTTP_HOST:-127.0.0.1}"
MCP_PORT="${MCP_HTTP_PORT:-3737}"
MCP_ENDPOINT=""
MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-}"
TEMP_FILES=()

# Ensures temporary header/body files never remain on disk after interruption.
cleanup_temp_files() {
  for file in "${TEMP_FILES[@]}"; do
    rm -f "$file" 2>/dev/null || true
  done
}

trap cleanup_temp_files EXIT INT TERM

usage() {
  cat <<'EOF'
Usage: scripts/stress-index-qa.sh [options]

Options:
  -n, --count <num>              Number of Q/A interactions to submit (default: 500)
  --seed-count <num>         Number of realistic seed Q/A interactions (default: 300)
      --top-k <num>              topK for query calls (default: 5)
      --quality <0..1>           qualityScore for feedback calls (default: 0.95)
      --route <name>             Route label in feedback payload (default: qa-bulk)
      --delay <seconds>          Delay between interactions (default: 0.02)
      --learn-every <num>        Trigger learn every N interactions (default: 100)
  --extra-feedback <num>     Additional feedback-only calls after ingestion (default: 120)
      --host <host>              MCP HTTP host (default from MCP_HTTP_HOST or 127.0.0.1)
      --port <port>              MCP HTTP port (default from MCP_HTTP_PORT or 3737)
      --endpoint <url>           Full MCP endpoint, overrides host/port (example: http://127.0.0.1:3737/mcp)
      --token <token>            Bearer token (default from MCP_AUTH_TOKEN)
      --timeout <seconds>        Curl timeout per request (default: 30)
  -h, --help                     Show this help

Environment:
  ENV_FILE                       Optional .env path override (default: <repo>/.env)
  MCP_AUTH_TOKEN                 Required if server enforces bearer auth
  MCP_HTTP_HOST, MCP_HTTP_PORT   Used as defaults for host/port
  COUNT, SEED_COUNT, TOP_K       Optional defaults for same-name options
  QUALITY_SCORE, ROUTE           Optional defaults for same-name options
  DELAY_SECONDS                  Optional default for --delay
  FORCE_LEARN_EVERY              Optional default for --learn-every
  EXTRA_FEEDBACK_COUNT           Optional default for --extra-feedback
  TIMEOUT_SECONDS                Optional default for --timeout

Example:
  MCP_AUTH_TOKEN=dev-secret-123456 scripts/stress-index-qa.sh --seed-count 600 -n 400 --extra-feedback 300
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--count)
      COUNT="$2"
      shift 2
      ;;
    --seed-count)
      SEED_COUNT="$2"
      shift 2
      ;;
    --top-k)
      TOP_K="$2"
      shift 2
      ;;
    --quality)
      QUALITY_SCORE="$2"
      shift 2
      ;;
    --route)
      ROUTE="$2"
      shift 2
      ;;
    --delay)
      DELAY_SECONDS="$2"
      shift 2
      ;;
    --learn-every)
      FORCE_LEARN_EVERY="$2"
      shift 2
      ;;
    --extra-feedback)
      EXTRA_FEEDBACK_COUNT="$2"
      shift 2
      ;;
    --host)
      MCP_HOST="$2"
      shift 2
      ;;
    --port)
      MCP_PORT="$2"
      shift 2
      ;;
    --endpoint)
      MCP_ENDPOINT="$2"
      shift 2
      ;;
    --token)
      MCP_AUTH_TOKEN="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# Enforces required external tool availability before network work starts.
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

if [[ -z "${MCP_ENDPOINT}" ]]; then
  MCP_ENDPOINT="http://${MCP_HOST}:${MCP_PORT}/mcp"
fi

HEALTH_ENDPOINT="${MCP_ENDPOINT%/mcp}/health"

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [[ "$COUNT" -lt 1 ]]; then
  echo "Invalid --count value: ${COUNT}" >&2
  exit 1
fi

if ! [[ "$SEED_COUNT" =~ ^[0-9]+$ ]] || [[ "$SEED_COUNT" -lt 0 ]]; then
  echo "Invalid --seed-count value: ${SEED_COUNT}" >&2
  exit 1
fi

if ! [[ "$TOP_K" =~ ^[0-9]+$ ]] || [[ "$TOP_K" -lt 1 ]] || [[ "$TOP_K" -gt 20 ]]; then
  echo "Invalid --top-k value: ${TOP_K}. Must be integer in [1, 20]." >&2
  exit 1
fi

if ! [[ "$FORCE_LEARN_EVERY" =~ ^[0-9]+$ ]] || [[ "$FORCE_LEARN_EVERY" -lt 1 ]]; then
  echo "Invalid --learn-every value: ${FORCE_LEARN_EVERY}" >&2
  exit 1
fi

if ! [[ "$EXTRA_FEEDBACK_COUNT" =~ ^[0-9]+$ ]] || [[ "$EXTRA_FEEDBACK_COUNT" -lt 0 ]]; then
  echo "Invalid --extra-feedback value: ${EXTRA_FEEDBACK_COUNT}" >&2
  exit 1
fi

if ! [[ "$QUALITY_SCORE" =~ ^(0(\.[0-9]+)?|1(\.0+)?)$ ]]; then
  echo "Invalid --quality value: ${QUALITY_SCORE}. Must be number in [0, 1]." >&2
  exit 1
fi

if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -lt 1 ]] || [[ "$TIMEOUT_SECONDS" -gt 300 ]]; then
  echo "Invalid --timeout value: ${TIMEOUT_SECONDS}. Must be integer in [1, 300]." >&2
  exit 1
fi

if ! [[ "$DELAY_SECONDS" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "Invalid --delay value: ${DELAY_SECONDS}. Must be non-negative number." >&2
  exit 1
fi

auth_header=()
if [[ -n "${MCP_AUTH_TOKEN}" ]]; then
  auth_header=("Authorization: Bearer ${MCP_AUTH_TOKEN}")
fi
json_header=("Content-Type: application/json")
accept_header=("Accept: application/json, text/event-stream")

# Executes one MCP POST and returns temp header/body file paths for caller parsing.
http_post() {
  local payload="$1"
  local session_id="${2:-}"

  local tmp_headers
  local tmp_body
  tmp_headers="$(mktemp)"
  tmp_body="$(mktemp)"
  TEMP_FILES+=("$tmp_headers" "$tmp_body")

  local -a headers
  headers=("-H" "${json_header[0]}" "-H" "${accept_header[0]}")
  if [[ ${#auth_header[@]} -gt 0 ]]; then
    headers+=("-H" "${auth_header[0]}")
  fi
  if [[ -n "$session_id" ]]; then
    headers+=("-H" "mcp-session-id: ${session_id}")
  fi

  curl -sS \
    --max-time "$TIMEOUT_SECONDS" \
    -D "$tmp_headers" \
    -o "$tmp_body" \
    -X POST "$MCP_ENDPOINT" \
    "${headers[@]}" \
    --data "$payload"

  printf '%s\n' "$tmp_headers"
  printf '%s\n' "$tmp_body"
}

# Extracts MCP session id negotiated at initialize response headers.
parse_session_id_from_headers() {
  local headers_file="$1"
  awk 'tolower($1) == "mcp-session-id:" {gsub(/\r/, "", $2); print $2}' "$headers_file" | tail -n1
}

# Normalizes MCP response body into single JSON object string (plain JSON or SSE data line).
extract_response_json() {
  local body_file="$1"

  if jq -e . "$body_file" >/dev/null 2>&1; then
    cat "$body_file"
    return 0
  fi

  local sse_json
  sse_json="$(awk '/^data:[[:space:]]*/ {sub(/^data:[[:space:]]*/, "", $0); if (length($0) > 0) last = $0} END {print last}' "$body_file")"

  if [[ -n "$sse_json" ]] && jq -e . >/dev/null 2>&1 <<<"$sse_json"; then
    printf '%s\n' "$sse_json"
    return 0
  fi

  return 1
}

# Reads JSON-RPC error message from response body if present; empty string means no protocol error.
extract_jsonrpc_error() {
  local body_file="$1"
  local response_json

  if ! response_json="$(extract_response_json "$body_file")"; then
    echo ""
    return
  fi

  jq -r 'if .error then (.error.message // "unknown error") else "" end' <<<"$response_json"
}

# Reduces log leakage by printing only JSON-RPC error section on failures.
print_error_summary() {
  local body_file="$1"
  local response_json
  if response_json="$(extract_response_json "$body_file")"; then
    jq -c '{id, error}' <<<"$response_json" 2>/dev/null || echo '{"error":"invalid-json-body"}'
  else
    echo '{"error":"non-json error body"}'
  fi
}

# Re-runs the MCP initialize handshake and updates the global SESSION_ID.
# Called automatically when a session expires mid-run (HTTP 400 invalid session).
reinitialize_session() {
  local init_payload='{"jsonrpc":"2.0","id":"reinit-1","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa-stress-loader","version":"1.0.0"}}}'
  local rh rb new_session

  mapfile -t _ri_files < <(http_post "$init_payload")
  rh="${_ri_files[0]}"
  rb="${_ri_files[1]}"

  new_session="$(parse_session_id_from_headers "$rh")"
  rm -f "$rh" "$rb"

  if [[ -z "$new_session" ]]; then
    echo "reinitialize_session: failed to obtain new session id" >&2
    return 1
  fi

  SESSION_ID="$new_session"
  echo "Session expired — reconnected: ${SESSION_ID}" >&2
}

# Executes tools/call and returns response body JSON on success.
# Retries up to RETRY_MAX times on HTTP 429, honouring Retry-After header when present.
# On HTTP 400 invalid-session, re-initializes the session once and retries the call.
call_tool() {
  # session_id arg kept for call-site compatibility; SESSION_ID global used directly so
  # transparent session renewals take effect without callers needing to update their local vars.
  local tool_name="$2"
  local args_json="$3"
  local req_id="$4"

  local payload
  payload="$(jq -cn \
    --arg id "$req_id" \
    --arg name "$tool_name" \
    --argjson args "$args_json" \
    '{jsonrpc:"2.0",id:$id,method:"tools/call",params:{name:$name,arguments:$args}}')"

  local attempt=0
  local backoff=1
  local session_renewed=0
  local header_file body_file http_code

  while true; do
    # Always use current global SESSION_ID so session renewals take effect mid-loop.
    mapfile -t _http_files < <(http_post "$payload" "$SESSION_ID")
    header_file="${_http_files[0]}"
    body_file="${_http_files[1]}"

    http_code="$(awk '/^HTTP\// {code=$2} END {print code}' "$header_file")"

    if [[ "$http_code" == "429" ]]; then
      attempt=$(( attempt + 1 ))
      if (( attempt > RETRY_MAX )); then
        echo "HTTP 429 during ${tool_name} call — exhausted ${RETRY_MAX} retries" >&2
        print_error_summary "$body_file" >&2
        rm -f "$header_file" "$body_file"
        return 1
      fi
      # Honour Retry-After if server provides it, else exponential backoff
      local retry_after
      retry_after="$(awk 'tolower($1) == "retry-after:" {gsub(/\r/,"",$2); print $2}' "$header_file" | tail -n1)"
      local wait="${retry_after:-$backoff}"
      echo "Rate limited (429) on ${tool_name} — waiting ${wait}s (attempt ${attempt}/${RETRY_MAX})" >&2
      sleep "$wait"
      backoff=$(( backoff * 2 ))
      rm -f "$header_file" "$body_file"
      continue
    fi

    # Session dropped (transport closed while script was waiting). Renew once then retry.
    if [[ "$http_code" == "400" && "$session_renewed" -eq 0 ]]; then
      local body_preview
      body_preview="$(cat "$body_file" 2>/dev/null || true)"
      if [[ "$body_preview" == *"Invalid or unknown Mcp-Session-Id"* ]]; then
        rm -f "$header_file" "$body_file"
        session_renewed=1
        if reinitialize_session; then
          continue
        fi
        return 1
      fi
    fi

    break
  done

  if [[ "$http_code" != "200" ]]; then
    echo "HTTP ${http_code} during ${tool_name} call" >&2
    print_error_summary "$body_file" >&2
    rm -f "$header_file" "$body_file"
    return 1
  fi

  local err
  err="$(extract_jsonrpc_error "$body_file")"
  if [[ -n "$err" ]]; then
    echo "Tool call failed (${tool_name}): ${err}" >&2
    print_error_summary "$body_file" >&2
    rm -f "$header_file" "$body_file"
    return 1
  fi

  local response_json
  if ! response_json="$(extract_response_json "$body_file")"; then
    echo "Tool call failed (${tool_name}): response body is not parseable JSON/SSE" >&2
    print_error_summary "$body_file" >&2
    rm -f "$header_file" "$body_file"
    return 1
  fi

  printf '%s\n' "$response_json"
  rm -f "$header_file" "$body_file"
}

# Builds realistic, varied support Q/A seed text so retrieval tests are not index-only patterns.
build_seed_pair() {
  local i="$1"

  local -a intents=(
    "reset account password"
    "rotate API key"
    "configure SSO login"
    "recover locked account"
    "enable webhook retries"
    "fix invoice mismatch"
    "update billing contact"
    "set MFA policy"
    "export audit logs"
    "restore deleted workspace"
    "configure rate limits"
    "set up role permissions"
  )
  local -a channels=("admin dashboard" "mobile app" "CLI" "REST API" "self-service portal")
  local -a constraints=(
    "without losing current sessions"
    "under strict compliance policy"
    "for multi-region tenants"
    "during incident response"
    "with least-privilege access"
  )
  local -a validations=(
    "verify action in audit log"
    "confirm change by test request"
    "store ticket id for rollback"
    "notify security owner"
    "capture before/after evidence"
  )

  local intent channel constraint validation
  intent="${intents[$((i % ${#intents[@]}))]}"
  channel="${channels[$(((i * 7) % ${#channels[@]}))]}"
  constraint="${constraints[$(((i * 11) % ${#constraints[@]}))]}"
  validation="${validations[$(((i * 13) % ${#validations[@]}))]}"

  local question
  local answer
  question="How do I ${intent} in ${channel} ${constraint}?"
  answer="Open account security settings, execute ${intent}, apply tenant policy guardrails, then ${validation}. If validation fails, rollback change and escalate to on-call support."

  printf '%s\n' "$question"
  printf '%s\n' "$answer"
}

# Sends one Q/A interaction through query + feedback and stores interaction id for reinforcement loop.
submit_qa_with_feedback() {
  local question="$1"
  local answer="$2"
  local route="$3"
  local quality="$4"
  local req_suffix="$5"

  local qa_text
  qa_text="Q: ${question}\\nA: ${answer}"

  local query_args
  query_args="$(jq -cn --arg text "$qa_text" --argjson topK "$TOP_K" '{text:$text,topK:$topK}')"

  local query_resp
  if ! query_resp="$(call_tool "$SESSION_ID" "query" "$query_args" "q-${req_suffix}")"; then
    failed=$((failed + 1))
    return
  fi

  # Handles both structuredContent-first and text-only MCP clients seen in mixed SDK versions.
  local interaction_id
  interaction_id="$(jq -r '.result.structuredContent.interactionId // ((.result.content[0].text // "{}") | fromjson? | .interactionId) // ""' <<<"$query_resp")"

  if [[ -z "$interaction_id" || "$interaction_id" == "null" ]]; then
    echo "Missing interactionId for item ${req_suffix}" >&2
    failed=$((failed + 1))
    return
  fi

  interaction_ids+=("$interaction_id")

  local feedback_args
  feedback_args="$(jq -cn \
    --arg interactionId "$interaction_id" \
    --argjson qualityScore "$quality" \
    --arg route "$route" \
    '{interactionId:$interactionId,qualityScore:$qualityScore,route:$route,forceLearnAfterFeedback:false}')"

  if ! call_tool "$SESSION_ID" "feedback" "$feedback_args" "f-${req_suffix}" >/dev/null; then
    failed=$((failed + 1))
    return
  fi

  submitted=$((submitted + 1))
}

echo "Checking MCP health at ${HEALTH_ENDPOINT} ..."
health_headers=()
health_headers=("-H" "${accept_header[0]}")
if [[ ${#auth_header[@]} -gt 0 ]]; then
  health_headers+=("-H" "${auth_header[0]}")
fi
curl -sS --max-time "$TIMEOUT_SECONDS" "${health_headers[@]}" "$HEALTH_ENDPOINT" | jq . >/dev/null

echo "Initializing MCP session at ${MCP_ENDPOINT} ..."
init_payload='{"jsonrpc":"2.0","id":"init-1","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa-stress-loader","version":"1.0.0"}}}'

mapfile -t _init_files < <(http_post "$init_payload")
init_headers="${_init_files[0]}"
init_body="${_init_files[1]}"

init_error="$(extract_jsonrpc_error "$init_body")"
if [[ -n "$init_error" ]]; then
  echo "Initialize failed: ${init_error}" >&2
  print_error_summary "$init_body" >&2
  rm -f "$init_headers" "$init_body"
  exit 1
fi

if [[ -z "${SESSION_ID:-}" ]]; then
  SESSION_ID="$(parse_session_id_from_headers "$init_headers")"
fi

if [[ -z "$SESSION_ID" ]] && [[ -z "$init_error" ]]; then
  echo "Missing mcp-session-id after initialize. Raw response:" >&2
  print_error_summary "$init_body" >&2
  rm -f "$init_headers" "$init_body"
  exit 1
fi

rm -f "$init_headers" "$init_body"

echo "Session initialized: ${SESSION_ID}"
echo "Submitting seed + bulk Q/A interactions ..."

failed=0
submitted=0
declare -a interaction_ids=()

if [[ "$SEED_COUNT" -gt 0 ]]; then
  echo "Generating ${SEED_COUNT} realistic seed interactions ..."
  for i in $(seq 1 "$SEED_COUNT"); do
    mapfile -t seed_pair < <(build_seed_pair "$i")
    submit_qa_with_feedback "${seed_pair[0]}" "${seed_pair[1]}" "seed-${ROUTE}" "$QUALITY_SCORE" "seed-${i}"

    # Periodic learn keeps consolidation visible during load tests without per-item overhead.
    if (( i % FORCE_LEARN_EVERY == 0 )); then
      learn_resp="$(call_tool "$SESSION_ID" "learn" '{}' "l-seed-${i}")"
      entries="$(jq -r '.result.structuredContent.stats.ruvector_entries // "unknown"' <<<"$learn_resp")"
      echo "Seed progress ${i}/${SEED_COUNT} | ruvector_entries=${entries} | failed=${failed}"
    elif (( i % 25 == 0 )); then
      echo "Seed progress ${i}/${SEED_COUNT} | failed=${failed}"
    fi

    sleep "$DELAY_SECONDS"
  done
fi

echo "Submitting ${COUNT} synthetic bulk interactions ..."

for i in $(seq 1 "$COUNT"); do
  question="How do I handle support scenario ${i}?"
  answer="Open settings, follow workflow ${i}, confirm result, then save confirmation id ${i}."
  submit_qa_with_feedback "$question" "$answer" "$ROUTE" "$QUALITY_SCORE" "bulk-${i}"

  # Periodic learn keeps consolidation visible during load tests without per-item overhead.
  if (( i % FORCE_LEARN_EVERY == 0 )); then
    learn_resp="$(call_tool "$SESSION_ID" "learn" '{}' "l-${i}")"
    entries="$(jq -r '.result.structuredContent.stats.ruvector_entries // "unknown"' <<<"$learn_resp")"
    echo "Progress ${i}/${COUNT} | ruvector_entries=${entries} | failed=${failed}"
  elif (( i % 25 == 0 )); then
    echo "Progress ${i}/${COUNT} | failed=${failed}"
  fi

  sleep "$DELAY_SECONDS"
done

if (( EXTRA_FEEDBACK_COUNT > 0 )) && (( ${#interaction_ids[@]} > 0 )); then
  echo "Running ${EXTRA_FEEDBACK_COUNT} extra feedback-only calls ..."
  for j in $(seq 1 "$EXTRA_FEEDBACK_COUNT"); do
    target_id="${interaction_ids[$(((j - 1) % ${#interaction_ids[@]}))]}"

    if (( j % 5 == 0 )); then
      feedback_score="0.70"
      feedback_route="${ROUTE}-reinforce-low"
    else
      feedback_score="0.99"
      feedback_route="${ROUTE}-reinforce-high"
    fi

    extra_feedback_args="$(jq -cn \
      --arg interactionId "$target_id" \
      --argjson qualityScore "$feedback_score" \
      --arg route "$feedback_route" \
      '{interactionId:$interactionId,qualityScore:$qualityScore,route:$route,forceLearnAfterFeedback:false}')"

    if ! call_tool "$SESSION_ID" "feedback" "$extra_feedback_args" "fx-${j}" >/dev/null; then
      failed=$((failed + 1))
    fi

    if (( j % 50 == 0 )); then
      echo "Extra feedback progress ${j}/${EXTRA_FEEDBACK_COUNT} | failed=${failed}"
    fi

    sleep "$DELAY_SECONDS"
  done
fi

echo "Running final learn and retrieval checks ..."
final_learn="$(call_tool "$SESSION_ID" "learn" '{}' "l-final")"
final_entries="$(jq -r '.result.structuredContent.stats.ruvector_entries // "unknown"' <<<"$final_learn")"

check_query_args="$(jq -cn --arg text 'How do I handle support scenario 1?' --argjson topK "$TOP_K" '{text:$text,topK:$topK}')"
check_query_resp="$(call_tool "$SESSION_ID" "query" "$check_query_args" "q-check")"
pattern_count="$(jq -r '(.result.structuredContent.patternSummaries // .result.structuredContent.patterns // []) | length' <<<"$check_query_resp")"

echo "Done."
echo "Total Q/A submitted (seed+bulk): ${submitted}"
echo "Seed interactions requested: ${SEED_COUNT}"
echo "Bulk interactions requested: ${COUNT}"
echo "Extra feedback calls requested: ${EXTRA_FEEDBACK_COUNT}"
echo "Failed calls: ${failed}"
echo "Final ruvector_entries: ${final_entries}"
echo "Retrieval pattern summaries for known prompt: ${pattern_count}"

if [[ "$failed" -gt 0 ]]; then
  exit 2
fi
