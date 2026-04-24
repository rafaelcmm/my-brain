# my-brain

Self-hosted memory and orchestration stack for MCP-capable clients.

## Services

- `my-brain-db`: Postgres + ruvector extension
- `my-brain-orchestrator`: memory runtime + synthesis envelope APIs
- `my-brain-mcp`: MCP bridge exposing tool surface
- `my-brain-web`: Next.js operator UI
- `my-brain-gateway`: ingress and auth boundary

## v2 Contract

All successful `mb_*` tool responses are envelope-shaped:

```json
{
  "success": true,
  "summary": "Human-readable answer",
  "data": {},
  "synthesis": {
    "status": "ok|fallback",
    "model": "qwen3.5:0.8b",
    "latency_ms": 123,
    "error": "optional"
  }
}
```

`data` remains canonical payload. `summary` is operator-facing synthesis.

Removed in v2:

- `mode: raw|processed`
- client-selected synthesis `model`
- `/v1/memory/backfill`
- legacy `hooks_stats` passthrough path

## Quick Start

```bash
docker compose up -d --build
```

Then run checks from root:

```bash
pnpm install
pnpm lint
pnpm test
pnpm format:check
docker compose config
./src/scripts/smoke-test.sh
./src/scripts/security-check.sh
```

## Security Defaults

- Default bind host remains `127.0.0.1`.
- Gateway strips external `Authorization` before upstream forward.
- Internal traffic uses `MYBRAIN_INTERNAL_API_KEY`.
- Keep `.secrets/` directory `700`, token files `600`.

## Documentation

- API details: `docs/technical/reference.md`
- Architecture: `docs/technical/architecture.md`
- Configuration: `docs/technical/configuration.md`
- Security: `docs/technical/security.md`
- Local operations: `docs/runbooks/local-operations.md`
