# Reference

## Exposed Endpoints

1. MCP SSE: http://127.0.0.1:${MYBRAIN_MCP_PORT}/sse
2. REST health: http://127.0.0.1:${MYBRAIN_REST_PORT}/health
3. REST status: http://127.0.0.1:${MYBRAIN_REST_PORT}/v1/status

## Core Commands

1. Start memory mode:
   docker compose up -d
2. Start full mode:
   MYBRAIN_MODE=full docker compose --profile full up -d
3. Stop stack:
   docker compose down
4. Rotate token:
   ./src/scripts/rotate-token.sh
5. Smoke test:
   ./src/scripts/smoke-test.sh

## Required Secret Files

1. .secrets/auth-token
2. .secrets/auth-token.previous

## CI Workflows

1. ci.yml: lint, test, shellcheck, compose validation, caddy validation, docker build.
2. release-please.yml: semantic release PR automation.
3. release.yml: multi-arch image publish and release tarball upload.
