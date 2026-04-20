# my-brain Technical Reference

This file is API and configuration reference for maintainers.

## REST endpoints

- `GET /health`: orchestrator liveness.
- `GET /v1/status`: orchestrator status snapshot.
- `GET /v1/capabilities`: engine/vector/sona/attention capability flags and degraded-mode reasons.
- `POST /v1/context/probe`: derives repo/project/language/framework context from local workspace.
- `POST /v1/memory`: writes validated memory envelope and metadata sidecar row.

More endpoints are added incrementally and documented here in same change set.

## Environment variables

Core variables currently consumed by runtime:

- `MYBRAIN_DB_URL`
- `MYBRAIN_LLM_URL`
- `MYBRAIN_LLM_MODEL`
- `MYBRAIN_EMBEDDING_MODEL`
- `MYBRAIN_EMBEDDING_DIM`
- `RUVECTOR_HOST`
- `RUVECTOR_PORT`
- `RUVLLM_SONA_ENABLED`

## Bridge contract

Bridge supports streamable HTTP MCP transport and acts as tool facade over upstream runtime tools.
