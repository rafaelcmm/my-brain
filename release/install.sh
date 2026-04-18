#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[my-brain-install] %s\n' "$*"
}

fail() {
  printf '[my-brain-install] error: %s\n' "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  has_cmd "$1" || fail "missing required command: $1"
}

download_file() {
  local url="$1"
  local destination="$2"

  if has_cmd curl; then
    curl -fsSL "$url" -o "$destination"
    return
  fi

  if has_cmd wget; then
    wget -qO "$destination" "$url"
    return
  fi

  fail "curl or wget is required"
}

fetch_text() {
  local url="$1"

  if has_cmd curl; then
    curl -fsSL "$url"
    return
  fi

  if has_cmd wget; then
    wget -qO- "$url"
    return
  fi

  fail "curl or wget is required"
}

checksum_verify() {
  local checksum_file="$1"

  if has_cmd sha256sum; then
    sha256sum -c "$checksum_file" >/dev/null
    return
  fi

  if has_cmd shasum; then
    shasum -a 256 -c "$checksum_file" >/dev/null
    return
  fi

  fail "sha256sum or shasum is required"
}

resolve_version() {
  local repo="$1"

  if [[ -n "${MY_BRAIN_VERSION:-}" ]]; then
    printf '%s\n' "$MY_BRAIN_VERSION"
    return
  fi

  local api_url="https://api.github.com/repos/${repo}/releases/latest"
  local latest_tag
  latest_tag="$(fetch_text "$api_url" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"

  if [[ -z "$latest_tag" ]]; then
    fail "failed to resolve latest release tag; set MY_BRAIN_VERSION explicitly"
  fi

  printf '%s\n' "$latest_tag"
}

generate_bootstrap_token() {
  if has_cmd openssl; then
    openssl rand -hex 32
    return
  fi

  od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
}

upsert_env() {
  local key="$1"
  local value="$2"
  local env_file="$3"

  if grep -qE "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$env_file"
  fi
}

main() {
  umask 077

  local repo="${MY_BRAIN_REPO:-rafaelmonteiro/my-brain}"
  local install_dir="${MY_BRAIN_HOME:-${HOME}/.my-brain}"

  require_cmd docker
  require_cmd tar

  docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"

  has_cmd curl || has_cmd wget || fail "curl or wget is required"
  has_cmd sha256sum || has_cmd shasum || fail "sha256sum or shasum is required"

  local version
  version="$(resolve_version "$repo")"

  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version must match vX.Y.Z (got: $version)"

  local release_dir_name="my-brain-release-${version}"
  local archive_name="${release_dir_name}.tar.gz"
  local checksum_name="${release_dir_name}.sha256"
  local base_url="https://github.com/${repo}/releases/download/${version}"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  log "downloading ${archive_name}"
  download_file "${base_url}/${archive_name}" "${tmp_dir}/${archive_name}"

  log "downloading ${checksum_name}"
  download_file "${base_url}/${checksum_name}" "${tmp_dir}/${checksum_name}"

  log "verifying checksum"
  (
    cd "$tmp_dir"
    checksum_verify "$checksum_name"
  )

  log "extracting release bundle"
  tar -xzf "${tmp_dir}/${archive_name}" -C "$tmp_dir"

  local bundle_dir="${tmp_dir}/${release_dir_name}"
  [[ -d "$bundle_dir" ]] || fail "bundle directory missing after extraction"

  mkdir -p "$install_dir"
  cp "${bundle_dir}/docker-compose.release.yml" "${install_dir}/docker-compose.release.yml"
  cp "${bundle_dir}/env.release.example" "${install_dir}/env.release.example"
  cp "${bundle_dir}/INSTALL.md" "${install_dir}/INSTALL.md"

  local env_file="${install_dir}/.env"
  if [[ ! -f "$env_file" ]]; then
    cp "${install_dir}/env.release.example" "$env_file"
    log "created ${env_file} from env.release.example"
  fi

  if [[ -n "${MY_BRAIN_HTTP_PORT:-}" ]]; then
    upsert_env "MCP_HTTP_PORT" "$MY_BRAIN_HTTP_PORT" "$env_file"
  fi

  if [[ -n "${MY_BRAIN_IMAGE:-}" ]]; then
    upsert_env "MCP_IMAGE" "$MY_BRAIN_IMAGE" "$env_file"
  fi

  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

  local bootstrap_token
  bootstrap_token="$(generate_bootstrap_token)"
  export MCP_BOOTSTRAP_TOKEN="$bootstrap_token"

  local compose_cmd=(docker compose -f "${install_dir}/docker-compose.release.yml" --env-file "$env_file")

  log "initializing auth store with ephemeral bootstrap token"
  "${compose_cmd[@]}" run --rm --no-deps \
    -e MCP_BOOTSTRAP_TOKEN \
    brain-mcp node dist/cli/manage-auth-token.js init \
    --label "installer-bootstrap-${timestamp}" \
    --bootstrap-token-env MCP_BOOTSTRAP_TOKEN

  unset MCP_BOOTSTRAP_TOKEN
  bootstrap_token=""

  log "starting hardened container"
  "${compose_cmd[@]}" up -d

  log "rotating token and extracting plaintext once"
  local rotate_output
  rotate_output="$("${compose_cmd[@]}" exec -T brain-mcp \
    node dist/cli/manage-auth-token.js rotate \
    --label "installer-initial-rotate-${timestamp}")"

  local token
  token="$(printf '%s\n' "$rotate_output" | sed -n 's/^Token value (shown once): //p' | tail -n1)"
  [[ -n "$token" ]] || fail "token rotation output did not contain token value"

  local port
  port="$(awk -F= '/^MCP_HTTP_PORT=/{print $2}' "$env_file" | tail -n1)"
  port="${port:-3737}"

  printf '\n'
  log "install complete"
  printf 'Install dir: %s\n' "$install_dir"
  printf 'MCP endpoint: http://127.0.0.1:%s/mcp\n' "$port"
  printf 'Token (shown once): %s\n' "$token"
  printf '\n'
  printf 'Next: export MCP_AUTH_TOKEN and test:\n'
  printf 'export MCP_AUTH_TOKEN=%q\n' "$token"
  printf 'curl -i -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" -d '\''{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'\'' "http://127.0.0.1:%s/mcp"\n' "$port"
}

main "$@"
