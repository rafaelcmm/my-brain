# AGENTS

## Scope

Applies to src/orchestrator/ runtime code and container build.

## Responsibilities

1. Keep startup deterministic and configuration explicit.
2. Preserve health endpoint stability for gateway and CI probes.
3. Keep runtime aligned with the single supported full-stack deployment profile.

## Change Constraints

1. Any new public endpoint must be documented in docs/technical/reference.md.
2. Any new env var must be added to .env.example and README configuration table.
3. Keep container non-root and healthcheck intact.

## Validation

1. npm run lint --prefix src/orchestrator
2. npm run test --prefix src/orchestrator
3. docker build -f src/orchestrator/Dockerfile -t my-brain/orchestrator:local .
