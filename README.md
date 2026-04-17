# my-brain

Self-hosted MCP server MVP with hexagonal architecture.

- Tools: `query`, `feedback`, `learn`
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

Persistence detail: completed interaction embeddings are persisted in ruvector DB and used for similarity-backed memory retrieval in `query`.

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
For HTTP transport with Docker Compose, `MCP_AUTH_TOKEN` is mandatory.

## Run Local (stdio MCP)

```bash
yarn dev
```

To run HTTP transport locally without Docker:

```bash
MCP_TRANSPORT=http MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT=3737 MCP_AUTH_TOKEN=replace-with-16-plus-char-secret yarn dev
```

For browser-originated traffic, set `MCP_ALLOWED_ORIGINS` (comma-separated origins).

## Build + Start

```bash
yarn build
yarn start
```

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
# set MCP_AUTH_TOKEN in .env to a 16+ character secret
```

```bash
yarn docker:up
```

The container runs MCP over HTTP at `http://localhost:3737/mcp`.

HTTP transport requires a bearer token. Send:

```text
Authorization: Bearer <MCP_AUTH_TOKEN>
```

The example client in `examples/mcp.example.json` expects `MCP_AUTH_TOKEN` in your shell environment.

Security defaults in compose now bind to localhost and run hardened container settings (`read_only`, `cap_drop: ALL`, `no-new-privileges`, resource and log limits).
Compose fails fast during config/load if `MCP_AUTH_TOKEN` is missing.

State persistence:

- `brain_data` volume: `/data/ruvector.db`
- `brain_models` volume: cached embedding model files

Useful Docker commands:

```bash
yarn docker:down
yarn docker:restart
```

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
  "patterns": [
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
- For fast tests without model download, set `EMBEDDING_PROVIDER=hash`.
- Security boundary validates MCP tool inputs with Zod schemas.
- HTTP hardening uses `helmet`, rate limiting, and request-size limits configurable via env (`MCP_RATE_LIMIT_*`, `MCP_MAX_BODY_BYTES`).
- HTTP MCP auth is enforced with bearer token via `MCP_AUTH_TOKEN` when transport is `http`.
- `examples/mcp.example.json` requires HTTP transport (`MCP_TRANSPORT=http`).
