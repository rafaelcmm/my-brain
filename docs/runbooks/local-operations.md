# Local Operations Runbook (v2)

## Start Stack

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
```

## Required Validation Sequence

From repository root:

```bash
pnpm install
pnpm lint
pnpm test
pnpm format:check
docker compose config
./src/scripts/smoke-test.sh
./src/scripts/security-check.sh
```

Note: `smoke-test.sh` runs optional Newman checks when `newman` is installed.

## Health Endpoints

- Gateway proxied health: `/health`, `/ready`
- Internal status: `/v1/status` (internal key)
- Metrics: `/metrics` (internal key)

## Querying v2 Envelope APIs

Successful tool responses return `success + summary + data + synthesis`.

Common checks:

- `synthesis.status=ok`: summary produced by LLM.
- `synthesis.status=fallback`: backend returned data without synthesis.
- `data`: always use for machine decisions.

## Troubleshooting

### 429 spikes

- Inspect rate-limit buckets and client burst behavior.
- Confirm synthesis metrics do not increment on blocked requests.

### Empty summary with success=true

- Check `synthesis.status` and `synthesis.error`.
- Review LLM URL/model/timeout vars.

### Synthesis metrics and fallback drill

Use these checks to validate synthesis health with explicit metric evidence:

```bash
# Gateway exposes Prometheus metrics on the REST surface.
curl -s -H "Authorization: Bearer $(cat .secrets/auth-token)" \
	http://127.0.0.1:8080/metrics | grep '^mb_synthesis_total'

curl -s -H "Authorization: Bearer $(cat .secrets/auth-token)" \
	http://127.0.0.1:8080/metrics | grep '^mb_synthesis_latency_ms'
```

Expected shape includes `mb_synthesis_total{tool="mb_*",status="ok|fallback"}`.

Fake-Ollama workflow (force fallback, then restore):

```bash
# 1) Force synthesis transport failure by stopping local Ollama service.
docker compose stop my-brain-llm

# 2) Run smoke request while LLM is unreachable.
./src/scripts/smoke-test.sh

# 3) Confirm fallback increments in metrics.
curl -s -H "Authorization: Bearer $(cat .secrets/auth-token)" \
	http://127.0.0.1:8080/metrics | grep 'mb_synthesis_total{.*status="fallback"}'

# 4) Restore Ollama and wait for healthy state.
docker compose up -d my-brain-llm my-brain-llm-init

# 5) Re-run smoke and confirm synthesis returns to ok path.
./src/scripts/smoke-test.sh
curl -s -H "Authorization: Bearer $(cat .secrets/auth-token)" \
	http://127.0.0.1:8080/metrics | grep 'mb_synthesis_total{.*status="ok"}'
```

### Auth failures between services

- Validate token file mount and permissions.
- Validate `MYBRAIN_INTERNAL_API_KEY` consistency in compose env.
- Confirm gateway still strips external `Authorization` header upstream.
