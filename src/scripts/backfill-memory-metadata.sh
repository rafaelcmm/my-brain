#!/usr/bin/env bash
# Backfill legacy memory rows missing fingerprint/vector fields.

set -euo pipefail

ENV_FILE="${MYBRAIN_ENV_FILE:-.env}"
TOKEN_FILE="${MYBRAIN_TOKEN_FILE:-./.secrets/auth-token}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "missing token file: $TOKEN_FILE" >&2
  exit 1
fi

token="$(cat "$TOKEN_FILE")"
if [[ -z "$token" ]]; then
  echo "token file is empty: $TOKEN_FILE" >&2
  exit 1
fi

rest_port="${MYBRAIN_REST_PORT:-8080}"
batch_size="${1:-200}"

if ! [[ "$batch_size" =~ ^[0-9]+$ ]]; then
  echo "batch_size must be an integer" >&2
  exit 1
fi

if (( batch_size < 1 || batch_size > 1000 )); then
  echo "batch_size must be in range [1, 1000]" >&2
  exit 1
fi

url="http://127.0.0.1:${rest_port}/v1/memory/backfill"

while true; do
  response="$(curl --max-time 60 -fsS \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    -d "{\"batch_size\":${batch_size}}" \
    "$url")"

  processed="$(echo "$response" | sed -n 's/.*"processed"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p')"
  updated="$(echo "$response" | sed -n 's/.*"updated"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p')"

  : "${processed:=0}"
  : "${updated:=0}"

  echo "backfill batch processed=${processed} updated=${updated}"

  if (( processed == 0 )); then
    break
  fi

done

echo "backfill complete"
