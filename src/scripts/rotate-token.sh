#!/usr/bin/env bash
# Rotate auth token in place using atomic replacement.

set -euo pipefail

TOKEN_FILE="${MYBRAIN_TOKEN_FILE:-./.secrets/auth-token}"
MIN_TOKEN_LENGTH="${MYBRAIN_MIN_TOKEN_LENGTH:-73}"
SECRETS_DIR="$(dirname "$TOKEN_FILE")"

if [[ ! -d "$SECRETS_DIR" ]]; then
  echo "secrets directory not found: $SECRETS_DIR" >&2
  exit 1
fi

if [[ -f "$TOKEN_FILE" ]]; then
  cp "$TOKEN_FILE" "${TOKEN_FILE}.previous"
  chmod 600 "${TOKEN_FILE}.previous"
fi

raw="$(openssl rand -base64 96 | tr -d '/+=\n' | cut -c1-64)"
new_token="my-brain-${raw}"
if [[ "${#new_token}" -lt "$MIN_TOKEN_LENGTH" ]]; then
  echo "generated token too short (${#new_token}); require >= ${MIN_TOKEN_LENGTH}" >&2
  exit 1
fi

tmp="$(mktemp "${TOKEN_FILE}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

printf '%s' "$new_token" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$TOKEN_FILE"

echo "Token rotated"
echo " old: ${TOKEN_FILE}.previous"
echo " new: ${TOKEN_FILE}"
echo
if command -v docker >/dev/null; then
  docker compose restart my-brain-gateway >/dev/null 2>&1 || true
  echo "gateway reload requested"
fi

echo "Refresh client auth from: ${TOKEN_FILE}"
