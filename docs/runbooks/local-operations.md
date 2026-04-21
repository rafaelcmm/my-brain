# Local Operations Runbook

## Start stack

```bash
docker compose up -d --build
```

## Verify health

```bash
docker compose ps
./src/scripts/smoke-test.sh
./src/scripts/simulation-replay-v2.sh
```

## Inspect metrics

```bash
curl -sS -H "Authorization: Bearer $(cat ./.secrets/auth-token)" http://127.0.0.1:8080/metrics | head
curl -sS -H "x-mybrain-internal-key: $(grep '^MYBRAIN_INTERNAL_API_KEY=' .env | cut -d= -f2)" http://127.0.0.1:9090/metrics | head
```

## Inspect logs

```bash
docker compose logs -f my-brain-gateway my-brain-mcp my-brain-orchestrator
```

## Stop stack

```bash
docker compose down
```

## Rotate token

```bash
./src/scripts/rotate-token.sh
```

## Troubleshooting quick checks

1. `docker compose config` must pass.
2. Gateway must return `401` without bearer token.
3. Gateway must return `410` for `/sse` and `/messages`.
4. MCP initialize on `/mcp` must return `200`.
