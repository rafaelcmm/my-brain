# my-brain production install (single instance)

This release bundle targets one Docker host with local persistent volumes.

## 0) One-command installer (curl|bash)

Pinned version install (recommended):

```bash
MY_BRAIN_VERSION="vX.Y.Z"; \
curl -fsSL "https://raw.githubusercontent.com/rafaelmonteiro/my-brain/${MY_BRAIN_VERSION}/release/install.sh" \
  | MY_BRAIN_VERSION="${MY_BRAIN_VERSION}" bash
```

Latest release install:

```bash
curl -fsSL "https://raw.githubusercontent.com/rafaelmonteiro/my-brain/main/release/install.sh" \
  | MY_BRAIN_REPO="rafaelmonteiro/my-brain" bash
```

Optional overrides:

- `MY_BRAIN_HOME` install directory (default `~/.my-brain`)
- `MY_BRAIN_HTTP_PORT` MCP HTTP port written into `.env`
- `MY_BRAIN_IMAGE` explicit image override (for mirrors/private registries)

Installer behavior summary:

- Downloads release `tar.gz` + `.sha256`
- Verifies checksum before extraction
- Initializes token store with ephemeral env-only bootstrap token
- Starts hardened compose service
- Rotates token and prints plaintext token once

Keep printed token in secret manager. Do not store plaintext token in shell history.

## Prerequisites

- Docker Engine 24+
- Docker Compose v2

## 1) Download release assets

Use release page assets for your version:

- `my-brain-release-vX.Y.Z.tar.gz`
- `my-brain-release-vX.Y.Z.sha256`

Verify checksum:

```bash
sha256sum -c my-brain-release-vX.Y.Z.sha256
```

Do not extract bundle until checksum verification succeeds.

## 2) Prepare runtime files

```bash
tar -xzf my-brain-release-vX.Y.Z.tar.gz
cd my-brain-release-vX.Y.Z
cp env.release.example .env
```

Edit `.env`:

- Set `MCP_IMAGE` to your release tag (already preset in release bundle)
- Optional: set `MCP_ALLOWED_ORIGINS`
- Optional first boot only: set `MCP_AUTH_TOKEN` with 32+ char bootstrap secret

## 3) Start instance

For first boot with empty token store and empty `MCP_AUTH_TOKEN`, initialize store before starting service:

```bash
docker compose -f docker-compose.release.yml --env-file .env \
  run --rm --no-deps \
  -e MCP_BOOTSTRAP_TOKEN="<32+ char secret>" \
  brain-mcp node dist/cli/manage-auth-token.js init \
  --label "initial-bootstrap" \
  --bootstrap-token-env MCP_BOOTSTRAP_TOKEN
```

Less secure fallback (secret can leak through shell history):

```bash
docker compose -f docker-compose.release.yml --env-file .env \
  run --rm --no-deps brain-mcp \
  node dist/cli/manage-auth-token.js init --label "initial-bootstrap" \
  --bootstrap-token "<32+ char secret>"
```

If `.env` already sets `MCP_AUTH_TOKEN`, one-off init is optional.

```bash
docker compose -f docker-compose.release.yml --env-file .env up -d
```

Health check:

```bash
docker compose -f docker-compose.release.yml --env-file .env ps
```

## 4) Token bootstrap and rotation

If token store is empty and no `MCP_AUTH_TOKEN` was provided, service fails closed.
After startup, rotate token from running container:

```bash
docker compose -f docker-compose.release.yml --env-file .env exec brain-mcp \
  node dist/cli/manage-auth-token.js rotate --label "initial-rotate"
```

Rotation command prints plaintext token one time. Update clients and clear bootstrap token from `.env`.

```bash
sed -i 's/^MCP_AUTH_TOKEN=.*/MCP_AUTH_TOKEN=/' .env
```

## 5) Validate token

```bash
PORT="$(awk -F= '/^MCP_HTTP_PORT=/{print $2}' .env | tail -n1)"
PORT="${PORT:-3737}"

curl -i \
  -H "Authorization: Bearer <NEW_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  "http://127.0.0.1:${PORT}/mcp"
```

Expected: HTTP 200 and tool list response.

## Upgrade

1. Update `MCP_IMAGE` in `.env` to next release tag.
2. Run `docker compose -f docker-compose.release.yml --env-file .env pull`.
3. Run `docker compose -f docker-compose.release.yml --env-file .env up -d`.

## Rollback

1. Set `MCP_IMAGE` back to previous known-good tag.
2. Pull + up again using same commands.

## Scope and limitation

This release flow supports single-instance deployment only. Token store is file-backed.
For multi-instance topology, use shared auth-token adapter (future work).
