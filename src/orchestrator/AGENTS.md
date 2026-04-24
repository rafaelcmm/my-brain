# AGENTS — src/orchestrator

## Scope

Applies to the orchestrator runtime: REST API, memory and learning services, Postgres adapter, container build.

## Responsibilities

1. Keep startup deterministic and configuration explicit — every runtime knob must come from an env var with a safe default.
2. Preserve `/health` and `/ready` endpoint stability for gateway probes, compose healthchecks, and CI.
3. Keep the runtime aligned with the single supported full-stack profile (Postgres + Ollama + bridge + web).

## Architecture cues

- HTTP entry point: `src/http/router.ts` dispatches on `method + url`. Route handlers live in `src/http/handlers/` — one file per endpoint.
- Domain logic (scoring, dedup, recall) is independent from HTTP. Handlers orchestrate; they do not contain business rules.
- Authentication: every non-health route requires the `x-mybrain-internal-key` header. The gateway injects it.

## Change Constraints

1. Any new public endpoint **must** be:
   - Added to `router.ts` dispatch.
   - Implemented as a dedicated file in `handlers/`.
   - Documented in `docs/technical/reference.md` in the same change.
2. Any new env var must be added to `.env.example` and `docs/technical/configuration.md`.
3. Any metrics counter change must be reflected in the `/metrics` section of `reference.md`.
4. Keep the container non-root and the healthcheck intact. The Dockerfile creates a `mybrain` user — do not break it.
5. Preserve soft/hard forget, dedup reasons, and vote bias semantics — they are exposed contract.

## Validation

Run from the repo root:

```bash
pnpm --filter ./src/orchestrator lint
pnpm --filter ./src/orchestrator test
pnpm --filter ./src/orchestrator build
docker build -f src/orchestrator/Dockerfile -t my-brain/orchestrator:local .
```

After compose up:

```bash
curl -fsS -H "x-mybrain-internal-key: $MYBRAIN_INTERNAL_API_KEY" \
  http://127.0.0.1:8080/ready
```

Expected: `200` with `{ ready: true }`-shaped payload once DB, ADR schemas, and LLM runtime are live.
