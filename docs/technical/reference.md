# my-brain Technical Reference

This file is API and configuration reference for maintainers.

## REST endpoints

- `GET /health`: orchestrator liveness.
- `GET /v1/status`: orchestrator status snapshot.

More endpoints are added incrementally and documented here in same change set.

## Environment variables

Core variables currently consumed by runtime:

- `MYBRAIN_DB_URL`
- `MYBRAIN_LLM_URL`
- `MYBRAIN_LLM_MODEL`
- `MYBRAIN_EMBEDDING_MODEL`
- `RUVECTOR_HOST`
- `RUVECTOR_PORT`
- `RUVLLM_SONA_ENABLED`

## Bridge contract

Bridge supports streamable HTTP MCP transport and acts as tool facade over upstream runtime tools.
