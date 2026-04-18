# src

Source tree details and runtime contracts.

## Runtime Commands

```bash
yarn dev
yarn start
yarn build
yarn test
yarn lint
yarn typecheck
yarn format:check
```

`yarn dev` starts Docker Compose in foreground. `yarn start` starts detached.

## Docker Runtime Notes

- MCP HTTP endpoint: `http://localhost:3737/mcp`
- Auth header: `Authorization: Bearer <MCP_AUTH_TOKEN>`
- Token store path default: `/data/mcp-auth-tokens.json`
- If token store empty and no bootstrap token exists, startup fails closed

Token management:

```bash
yarn auth:token:init
yarn auth:token:rotate --label "operator-rotate-2026-04-17"
```

Explicit bootstrap token init:

```bash
yarn auth:token:init --bootstrap-token "<32+ char secret>"
```

Useful compose commands:

```bash
yarn docker:up
yarn docker:down
yarn docker:restart
yarn db:clear --dry-run
yarn db:clear --force
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

## Persistence and Security Notes

- Interaction embeddings persist in ruvector DB (`RUVECTOR_DB_PATH`)
- Readable interaction metadata persists alongside vectors for explainable retrieval
- Model artifacts cached in `brain_models` volume to avoid repeated downloads
- Semantic retrieval is model-only; hash embedding fallback intentionally unsupported
- HTTP hardening uses `helmet`, rate limiting, and request-size limits (`MCP_RATE_LIMIT_*`, `MCP_MAX_BODY_BYTES`)
- HTTP auth enforces persisted hashed bearer tokens via `MCP_AUTH_STORE_PATH`
- Query text is persisted for explainable retrieval; treat deployment as trusted single-tenant unless redaction/retention/isolation added
