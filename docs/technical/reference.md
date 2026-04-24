# my-brain Technical Reference (v2)

## Response Envelope (tool endpoints)

All successful `mb_*` tool responses plus `/v1/capabilities` and `/v1/context/probe` return:

```json
{
  "success": true,
  "summary": "Human-readable synthesis string (empty on fallback)",
  "data": {},
  "synthesis": {
    "status": "ok",
    "model": "qwen3.5:0.8b",
    "latency_ms": 120,
    "error": "timeout after 15000ms"
  }
}
```

Rules:

- Error responses keep legacy shape: `{ success: false, error, message }`.
- `data` is source-of-truth payload for automation.
- `summary` is LLM guidance text.
- No per-call `mode` or `model`.

## REST Endpoints

| Path                 | Method | Auth            | Rate Limit Bucket | Success Shape        | Error Shape  |
| -------------------- | ------ | --------------- | ----------------- | -------------------- | ------------ |
| `/health`            | GET    | bearer/internal | none              | raw health object    | legacy error |
| `/ready`             | GET    | bearer/internal | none              | raw readiness object | legacy error |
| `/v1/status`         | GET    | internal key    | none              | raw status object    | legacy error |
| `/v1/capabilities`   | GET    | internal key    | none              | envelope             | legacy error |
| `/v1/context/probe`  | POST   | internal key    | none              | envelope             | legacy error |
| `/v1/memory`         | POST   | internal key    | `memory-write`    | envelope             | legacy error |
| `/v1/memory/recall`  | POST   | internal key    | `memory-recall`   | envelope             | legacy error |
| `/v1/memory/vote`    | POST   | internal key    | `memory-vote`     | envelope             | legacy error |
| `/v1/memory/forget`  | POST   | internal key    | `memory-forget`   | envelope             | legacy error |
| `/v1/memory/digest`  | POST   | internal key    | `memory-digest`   | envelope             | legacy error |
| `/v1/session/open`   | POST   | internal key    | `session-open`    | envelope             | legacy error |
| `/v1/session/close`  | POST   | internal key    | `session-close`   | envelope             | legacy error |
| `/v1/memory/summary` | GET    | internal key    | none              | raw summary object   | legacy error |
| `/v1/memory/list`    | GET    | internal key    | none              | raw list object      | legacy error |
| `/v1/memory/graph`   | GET    | internal key    | none              | raw graph object     | legacy error |
| `/v1/memory/{id}`    | GET    | internal key    | none              | raw memory object    | legacy error |
| `/v1/learning/stats` | GET    | internal key    | none              | raw stats object     | legacy error |
| `/metrics`           | GET    | internal key    | none              | Prometheus text      | plain error  |

## Request Body Notes

- `POST /v1/memory/recall`: rejects `mode` and `model` with `400 INVALID_INPUT`.
- `POST /v1/memory`: expects validated memory envelope fields (`content`, `type`, `scope`, `metadata`).
- `POST /v1/memory/forget`: `mode` accepts `soft` or `hard`.

## Environment Variables

### Orchestrator

| Name                                | Type   | Default                   | Reader                                        |
| ----------------------------------- | ------ | ------------------------- | --------------------------------------------- |
| `MYBRAIN_DB_URL`                    | string | none                      | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_LLM_URL`                   | string | `""`                      | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_LLM_MODEL`                 | string | `qwen3.5:0.8b`            | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_RECALL_PROCESS_TIMEOUT_MS` | int    | `180000`                  | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_SYNTH_TIMEOUT_MS`          | int    | `15000`                   | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_EMBEDDING_MODEL`           | string | `qwen3-embedding:0.6b`    | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_EMBEDDING_DIM`             | int    | `1024`                    | `src/orchestrator/src/config/load-config.ts`  |
| `RUVECTOR_PORT`                     | int    | `8080`                    | `src/orchestrator/src/config/load-config.ts`  |
| `RUVLLM_SONA_ENABLED`               | bool   | `true`                    | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_AUTH_TOKEN_FILE`           | string | `/run/secrets/auth-token` | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_INTERNAL_API_KEY`          | string | `""`                      | `src/orchestrator/src/config/load-config.ts`  |
| `MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH`   | bool   | `false`                   | `src/orchestrator/src/bootstrap/main.ts`      |
| `MYBRAIN_RATE_LIMIT_PER_MIN`        | int    | `60`                      | `src/orchestrator/src/policies/rate-limit.ts` |
| `MYBRAIN_MAX_REQUEST_BODY_BYTES`    | int    | `1048576`                 | `src/orchestrator/src/bootstrap/main.ts`      |

### MCP Bridge

| Name                       | Type   | Default | Reader                                     |
| -------------------------- | ------ | ------- | ------------------------------------------ |
| `MYBRAIN_REST_URL`         | string | none    | `src/mcp-bridge/src/config/load-config.ts` |
| `MYBRAIN_INTERNAL_API_KEY` | string | none    | `src/mcp-bridge/src/config/load-config.ts` |
| `MYBRAIN_PROMETHEUS_PORT`  | int    | `9090`  | `src/mcp-bridge/src/config/load-config.ts` |

### Web

| Name                           | Type   | Default | Reader                          |
| ------------------------------ | ------ | ------- | ------------------------------- |
| `MYBRAIN_WEB_SESSION_SECRET`   | string | none    | `src/web/src/lib/config/env.ts` |
| `MYBRAIN_WEB_ORCHESTRATOR_URL` | string | none    | `src/web/src/lib/config/env.ts` |
| `MYBRAIN_INTERNAL_API_KEY`     | string | none    | `src/web/src/lib/config/env.ts` |
| `MYBRAIN_WEB_PUBLIC_BASE_URL`  | string | none    | `src/web/src/lib/config/env.ts` |
| `MYBRAIN_WEB_RATE_LIMIT_LOGIN` | int    | `5`     | `src/web/src/lib/config/env.ts` |
| `MYBRAIN_WEB_LOG_LEVEL`        | string | `info`  | `src/web/src/lib/config/env.ts` |

## Migration From v0/v1

Breaking changes:

- Removed legacy `mode: raw|processed` and `model` from recall.
- Removed `/v1/memory/backfill` endpoint and script.
- Removed upstream MCP passthrough and `hooks_stats` bridge path.
- Removed legacy env variables that had no TypeScript reader.
- All successful tool responses now use synthesis envelope.
