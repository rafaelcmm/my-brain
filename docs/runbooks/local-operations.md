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

### Auth failures between services

- Validate token file mount and permissions.
- Validate `MYBRAIN_INTERNAL_API_KEY` consistency in compose env.
- Confirm gateway still strips external `Authorization` header upstream.
