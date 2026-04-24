# Architecture (v2)

## Topology

my-brain runs five services through Docker Compose:

- `my-brain-db` (`src/db/`): Postgres + ruvector extension.
- `my-brain-orchestrator` (`src/orchestrator/`): policy + memory runtime + synthesis envelope producer.
- `my-brain-mcp` (`src/mcp-bridge/`): MCP tool surface mapped to orchestrator HTTP APIs.
- `my-brain-web` (`src/web/`): Next.js operator UI consuming envelope APIs.
- `my-brain-gateway` (`src/gateway/`): ingress, bearer auth, internal key injection.

Only gateway binds host port by default.

## Data Flow

1. Client calls gateway (`Authorization: Bearer <token>`).
2. Gateway strips external auth header before upstream forward, injects `MYBRAIN_INTERNAL_API_KEY`.
3. Orchestrator validates schema, auth, and rate limit before expensive synthesis.
4. Domain executes persistence/query logic against Postgres/ruvector.
5. Orchestrator attempts synthesis summary and returns envelope.
6. MCP bridge and web consume `data` + `summary` + `synthesis.status`.

## Hexagonal Boundaries

### Orchestrator

- Domain: `src/orchestrator/src/domain/`
- Application: `src/orchestrator/src/application/`
- HTTP adapters: `src/orchestrator/src/http/`
- Infra adapters: `src/orchestrator/src/infrastructure/`

### MCP Bridge

- Domain contracts: `src/mcp-bridge/src/domain/`
- Tool handlers: `src/mcp-bridge/src/mcp/handlers/`
- Upstream adapter: `src/mcp-bridge/src/infrastructure/orchestrator-client.ts`

### Web

- Domain + ports: `src/web/src/lib/domain/`, `src/web/src/lib/ports/`
- Infra adapters: `src/web/src/lib/infrastructure/`
- Use cases: `src/web/src/lib/application/`
- Routes/UI: `src/web/src/app/`

## v2 Envelope Contract

For successful tool-like operations, orchestrator emits:

```json
{
  "success": true,
  "summary": "String",
  "data": {},
  "synthesis": {
    "status": "ok|fallback",
    "model": "qwen3.5:0.8b",
    "latency_ms": 123,
    "error": "optional"
  }
}
```

Rate limit and validation run before synthesis for abuse resistance.

## Reliability Paths

- LLM timeout or failure produces `synthesis.status="fallback"` and empty/compact summary, while preserving `data`.
- Envelope shape checks in web and bridge reject malformed legacy payloads.
- Metrics expose synthesis latency/outcomes and endpoint policy counters.

## Removed Legacy Surface

- No per-call recall mode/model toggles.
- No `/v1/memory/backfill` API.
- No `hooks_stats` passthrough tool path in bridge.
- No synthesized "processed model" routing in clients.
