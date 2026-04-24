# Configuration (v2)

## Source of Truth

Defaults and parsing are code-defined. Keep docs aligned to readers:

- Orchestrator: `src/orchestrator/src/config/load-config.ts`
- MCP bridge: `src/mcp-bridge/src/config/load-config.ts`
- Web: `src/web/src/lib/config/env.ts`
- Gateway: `src/gateway/Caddyfile`
- Compose defaults: `docker-compose.yml`

## Core Variables

### Authentication

- `MYBRAIN_AUTH_TOKEN_FILE`: bearer token file mounted into gateway/orchestrator.
- `MYBRAIN_INTERNAL_API_KEY`: internal service auth key.
- `MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=false`: keep dual-auth enforcement unless explicit override needed.

### Network Binding

- `MYBRAIN_BIND_HOST=127.0.0.1` default; do not widen without explicit operator decision.
- Gateway is only host-exposed ingress.

### Synthesis and Recall

- `MYBRAIN_LLM_URL`
- `MYBRAIN_LLM_MODEL` (default `qwen3.5:0.8b`)
- `MYBRAIN_RECALL_PROCESS_TIMEOUT_MS`
- `MYBRAIN_SYNTH_TIMEOUT_MS`

### Embeddings

- `MYBRAIN_EMBEDDING_MODEL`
- `MYBRAIN_EMBEDDING_DIM`

### Limits

- `MYBRAIN_RATE_LIMIT_PER_MIN`
- `MYBRAIN_MAX_REQUEST_BODY_BYTES`

## Web Variables

- `MYBRAIN_WEB_SESSION_SECRET`
- `MYBRAIN_WEB_ORCHESTRATOR_URL`
- `MYBRAIN_WEB_PUBLIC_BASE_URL`
- `MYBRAIN_WEB_RATE_LIMIT_LOGIN`
- `MYBRAIN_WEB_LOG_LEVEL`

## Deprecated/Removed

Do not reintroduce:

- Per-request recall `mode`/`model` flags.
- Environment flags that have no active TypeScript reader.
- Backfill endpoint/runtime toggles tied to removed `/v1/memory/backfill`.

## Validation Workflow

Use:

```bash
pnpm install
pnpm lint
pnpm test
pnpm format:check
docker compose config
```

For auth/gateway/orchestrator security-sensitive changes also run:

```bash
./src/scripts/smoke-test.sh
./src/scripts/security-check.sh
```
