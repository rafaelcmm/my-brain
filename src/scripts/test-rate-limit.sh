#!/usr/bin/env bash
# Test rate limiting enforcement at the gateway.
# Sends burst of requests and verifies 429 responses after threshold.

set -euo pipefail

TOTAL_REQUESTS="${1:-100}"
EXPECTED_LIMIT="${2:-60}"
ENDPOINT="${3:-http://127.0.0.1:8080/health}"
TOKEN_FILE="${4:-.secrets/auth-token}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Token file not found: $TOKEN_FILE" >&2
  exit 1
fi

TOKEN="$(cat "$TOKEN_FILE")"

echo "Rate Limit Test"
echo "==============="
echo "Total requests: $TOTAL_REQUESTS"
echo "Expected limit: $EXPECTED_LIMIT req/min"
echo "Endpoint: $ENDPOINT"
echo

success=0
rate_limited=0
errors=0
start_time="$(date +%s)"

for i in $(seq 1 "$TOTAL_REQUESTS"); do
  http_code="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    --max-time 5 \
    "$ENDPOINT" || echo "ERR")"
  
  case "$http_code" in
    200)
      success=$((success + 1))
      ;;
    429)
      rate_limited=$((rate_limited + 1))
      ;;
    *)
      errors=$((errors + 1))
      ;;
  esac
  
  # Show progress every 10 requests
  if [[ $((i % 10)) -eq 0 ]]; then
    printf "."
  fi
done

end_time="$(date +%s)"
elapsed=$((end_time - start_time))

echo
echo
echo "Results"
echo "======="
echo "Elapsed: ${elapsed}s"
echo "Success (200): $success"
echo "Rate limited (429): $rate_limited"
echo "Errors: $errors"
echo

if [[ "$rate_limited" -eq 0 ]]; then
  echo "❌ FAIL: No rate limiting detected (expected ~$((TOTAL_REQUESTS - EXPECTED_LIMIT)) 429s)"
  exit 1
fi

if [[ "$success" -le "$EXPECTED_LIMIT" && "$rate_limited" -ge $((TOTAL_REQUESTS - EXPECTED_LIMIT - 10)) ]]; then
  echo "✅ PASS: Rate limiting working correctly"
  exit 0
else
  echo "⚠️  WARN: Rate limit behavior unexpected"
  echo "Expected ~${EXPECTED_LIMIT} success, ~$((TOTAL_REQUESTS - EXPECTED_LIMIT)) rate-limited"
  exit 1
fi
