# AGENTS

## Scope

Applies to orchestrator/ runtime code and container build.

## Responsibilities

1. Keep startup deterministic and configuration explicit.
2. Preserve health endpoint stability for gateway and CI probes.
3. Keep runtime compatible with memory mode and full mode.

## Change Constraints

1. Any new public endpoint must be documented in docs/technical/reference.md.
2. Any new env var must be added to .env.example and README configuration table.
3. Keep container non-root and healthcheck intact.

## Validation

1. npm run lint --prefix orchestrator
2. npm run test --prefix orchestrator
3. docker build -f orchestrator/Dockerfile -t my-brain/orchestrator:local .
