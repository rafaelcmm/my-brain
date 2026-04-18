# my-brain

Self-hosted MCP server MVP with hexagonal architecture.

- Tools: `query`, `inspect_interaction`, `feedback`, `learn`
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2` via `@xenova/transformers`
- Learning engine and adaptive storage: `@ruvector/sona`
- Persistence: `@ruvector/core` vector database (`RUVECTOR_DB_PATH`)

## Architecture

- Core: domain + ports + use-cases (framework-agnostic)
- Inbound adapter: MCP server (stdio and streamable HTTP)
- Outbound adapters:
  - MiniLM embedding adapter
  - SONA adaptive brain adapter
- Composition root wires dependencies

Persistence detail: completed interaction embeddings are persisted in ruvector DB, while readable interaction metadata is persisted alongside it for explainable similarity-backed retrieval in `query` and `inspect_interaction`.

ADR: `docs/architecture/adr-001-hexagonal-mcp-brain.md`

## Project Structure

```text
src/
  core/
    domain/
    ports/
    application/
      dto/
      use-cases/
  adapters/
    inbound/mcp/
    outbound/embeddings/
    outbound/sona/
  shared/config/
  composition/
```

## Requirements

- Node.js >= 22
- Corepack-enabled Yarn 1.22.x

## Setup

```bash
corepack enable
yarn install --frozen-lockfile
```

Container deployment has built-in defaults inside image/compose.
For HTTP transport with Docker Compose, auth tokens persist in `MCP_AUTH_STORE_PATH`.

## Development Runtime

```bash
yarn dev
```

This project is intended to run through Docker Compose during development. `yarn dev` starts the Compose stack in the foreground, and `yarn start` starts it detached.

For browser-originated traffic, set `MCP_ALLOWED_ORIGINS` in `.env` before you start the stack.

## App Build

```bash
yarn build
```

Use `yarn start` when you want the Docker stack running detached after the image builds.

## Production Releases

Tag pushes matching `vX.Y.Z` trigger automated release publishing:

- GHCR image: `ghcr.io/<owner>/my-brain:vX.Y.Z` and `latest`
- Release assets:
  - `my-brain-release-vX.Y.Z.tar.gz`
  - `my-brain-release-vX.Y.Z.sha256`

Release pipeline gates:

- lint
- format check
- test
- build
- container vulnerability scan (blocks HIGH/CRITICAL)

Install from release bundle:

1. Download `tar.gz` and `.sha256` from GitHub Releases.
2. Verify checksum (`sha256sum -c ...`).
3. Extract bundle and configure `.env` from `.env.release.example`.
4. If first boot has empty token store and no `MCP_AUTH_TOKEN`, run one-off bootstrap init with compiled CLI.
5. Start with `docker compose -f docker-compose.release.yml --env-file .env up -d`.
6. Rotate token from running container and remove bootstrap secret.

Operator runbook: `release/INSTALL.md`

## Test and Quality

```bash
yarn test
yarn lint
yarn typecheck
yarn format:check
yarn build
```

## Docker Compose (self-hosted)

Prepare required environment:

```bash
cp .env.example .env
# optional: set MCP_AUTH_TOKEN in .env to seed first token on initial startup (32+ chars)
```

```bash
yarn docker:up
```

The container runs MCP over HTTP at `http://localhost:3737/mcp`.

HTTP transport requires a bearer token. Send:

```text
Authorization: Bearer <MCP_AUTH_TOKEN>
```

If no token exists in persisted store, startup fails closed until token store is initialized. Store path defaults to `/data/mcp-auth-tokens.json`.

Manage tokens explicitly with scripts:

```bash
yarn auth:token:init
yarn auth:token:rotate --label "operator-rotate-2026-04-17"
```

You can also seed init explicitly:

```bash
yarn auth:token:init --bootstrap-token "<32+ char secret>"
```

For production runtime containers from release bundle directory, use compiled CLI with the same compose args used for startup:

```bash
# first boot only when token store is empty and MCP_AUTH_TOKEN is unset
docker compose -f docker-compose.release.yml --env-file .env \
  run --rm --no-deps \
  -e MCP_BOOTSTRAP_TOKEN="<32+ char secret>" \
  brain-mcp node dist/cli/manage-auth-token.js init \
  --label "initial-bootstrap" \
  --bootstrap-token-env MCP_BOOTSTRAP_TOKEN

docker compose -f docker-compose.release.yml --env-file .env exec brain-mcp \
  node dist/cli/manage-auth-token.js rotate --label "initial-rotate"
```

If `.env` already sets `MCP_AUTH_TOKEN`, pre-start init can be skipped.

The rotate command prints a new token once. Update your client environment (`MCP_AUTH_TOKEN`) and rotate immediately after initial bootstrap.

The example client in `examples/mcp.example.json` still expects `MCP_AUTH_TOKEN` in your shell environment.

Security defaults in compose now bind to localhost and run hardened container settings (`read_only`, `cap_drop: ALL`, `no-new-privileges`, resource and log limits).

State persistence:

- `brain_data` volume: `/data/ruvector.db`
- `brain_data` volume: `/data/mcp-auth-tokens.json` token store
- `brain_models` volume: cached embedding model files

Useful Docker commands:

```bash
yarn docker:down
yarn docker:restart
```

Local persistence reset:

```bash
yarn db:clear --force
```

Use `yarn db:clear --dry-run` first if you want to confirm which Docker actions and mounted files will be targeted.

## MCP Tool Contracts

### `query`

Input:

```json
{
  "text": "how do I reset password",
  "topK": 5
}
```

Output (shape):

```json
{
  "interactionId": "uuid",
  "matchedEvidence": [
    {
      "interactionId": "uuid",
      "text": "how do I unlock a locked account",
      "score": 0.91,
      "rawScore": 0.912345,
      "scoreType": "vectorSimilarity",
      "whyMatched": "Rank #1, raw score 0.912345, normalized similarity 91%. Route support-flow. Feedback quality 0.95.",
      "retrievalRank": 1,
      "route": "support-flow",
      "qualityScore": 0.95,
      "createdAtIso": "2026-04-17T12:00:00.000Z",
      "status": "completed"
    }
  ],
  "patternSummaries": [
    {
      "id": "pattern-id",
      "avgQuality": 0.91,
      "clusterSize": 12,
      "patternType": "General"
    }
  ],
  "stats": {}
}
```

### `inspect_interaction`

Input:

```json
{
  "interactionId": "uuid-from-query",
  "topK": 5
}
```

Output (shape):

```json
{
  "interaction": {
    "interactionId": "uuid-from-query",
    "queryText": "how do I unlock a locked account",
    "createdAtIso": "2026-04-17T12:00:00.000Z",
    "updatedAtIso": "2026-04-17T12:01:00.000Z",
    "status": "completed",
    "qualityScore": 0.95,
    "route": "support-flow",
    "completedAtIso": "2026-04-17T12:01:00.000Z"
  },
  "inspectionMode": "re-embedded-query",
  "matchedEvidence": [],
  "patternSummaries": [],
  "stats": {}
}
```

### `feedback`

Input:

```json
{
  "interactionId": "uuid-from-query",
  "qualityScore": 0.93,
  "route": "support-flow",
  "forceLearnAfterFeedback": true
}
```

Output:

```json
{
  "status": "feedback-recorded-and-learned",
  "learnStatus": "..."
}
```

### `learn`

Input: none

Output:

```json
{
  "status": "...",
  "stats": {}
}
```

## Notes

- First startup with MiniLM downloads model artifacts. Keep `brain_models` volume to avoid repeated downloads.
- Semantic retrieval is model-only; hash embedding fallback is intentionally unsupported.
- Query text is persisted for explainable retrieval. Treat this as a single-tenant trusted-memory feature unless you add redaction, retention, and tenant isolation.
- Security boundary validates MCP tool inputs with Zod schemas.
- HTTP hardening uses `helmet`, rate limiting, and request-size limits configurable via env (`MCP_RATE_LIMIT_*`, `MCP_MAX_BODY_BYTES`).
- HTTP MCP auth is enforced with persisted hashed bearer tokens via `MCP_AUTH_STORE_PATH` when transport is `http`.
- `examples/mcp.example.json` requires HTTP transport (`MCP_TRANSPORT=http`).
