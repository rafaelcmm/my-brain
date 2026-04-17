# my-brain

Self-hosted MCP server MVP with hexagonal architecture.

- Tools: `query`, `feedback`, `learn`
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2` via `@xenova/transformers`
- Learning engine and adaptive storage: `@ruvector/sona`
- Persistence: `@ruvector/core` vector database (`RUVECTOR_DB_PATH`)

## Architecture

- Core: domain + ports + use-cases (framework-agnostic)
- Inbound adapter: MCP stdio server
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
- npm >= 10

## Setup

```bash
npm install
cp .env.example .env
```

## Run Local (stdio MCP)

```bash
npm run dev
```

## Build + Start

```bash
npm run build
npm start
```

## Test and Quality

```bash
npm run test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

## Docker Compose (self-hosted)

```bash
cp .env.example .env
docker compose up --build
```

The service runs as stdio MCP process. For direct integration, configure your MCP client to use container process attach or run local binary via stdio.

State persistence:

- `brain_data` volume: `/data/ruvector.db`
- `brain_models` volume: cached embedding model files

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
