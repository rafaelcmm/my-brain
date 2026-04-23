# Local Operations Runbook

## Start stack

```bash
docker compose up -d --build
```

## Verify health

```bash
docker compose ps
./src/scripts/smoke-test.sh
```

## Open webapp

```bash
WEB_PORT="${MYBRAIN_WEB_PORT:-3000}"
xdg-open "http://127.0.0.1:${WEB_PORT}" 2>/dev/null || echo "open http://127.0.0.1:${WEB_PORT}"
```

Login uses token from `.secrets/auth-token` and creates an httpOnly `session` cookie.

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

## Rotate MYBRAIN_WEB_SESSION_SECRET

1. Update `.env` with a new high-entropy value (at least 32 chars):

```bash
openssl rand -base64 48
```

2. Replace `MYBRAIN_WEB_SESSION_SECRET=...` in `.env`.
3. Restart web container:

```bash
docker compose up -d --force-recreate my-brain-web
```

4. Expect active browser sessions to be invalidated and require login again.

## Emergency response

### Compromised token

```bash
./src/scripts/rotate-token.sh
docker compose restart my-brain-gateway
```

Then update every MCP client with the new token from `.secrets/auth-token`.

### Suspected brute-force or rate-limit issue

```bash
docker compose logs my-brain-gateway | grep ' 401 '
docker compose logs my-brain-gateway | grep ' 429 '
```

Repeated `401` entries from one source indicate bad-token retries. `429` confirms gateway rate limiting is active.

### Orchestrator fails after token rotation

```bash
./src/scripts/security-check.sh
docker compose logs my-brain-orchestrator | grep SECURITY
```

Check for missing token file, bad permissions, short token length, or wrong prefix before restarting the container.

## Troubleshooting quick checks

1. `docker compose config` must pass.
2. Gateway must return `401` without bearer token.
3. Gateway should emit `429` under repeated bad requests.
4. Gateway must return `410` for `/sse` and `/messages`.
5. MCP initialize on `/mcp` must return `200`.
