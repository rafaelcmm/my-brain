# my-brain Security Model

This document describes runtime security guarantees and operator responsibilities.

## Network and ingress

1. Default bind host is `127.0.0.1`. Only the Caddy gateway exposes ports to the host.
2. Gateway validates the bearer token for both the MCP endpoint (`:3333/mcp`) and REST API (`:8080/*`).
3. Gateway strips the `Authorization` header before forwarding to upstream services and injects the shared `x-mybrain-internal-key` header.
4. Upstream services (orchestrator, bridge, web) reject requests that do not carry the internal key.

## Token management

1. The bearer token lives in `.secrets/auth-token` (gitignored, mode 0600).
2. `src/scripts/rotate-token.sh` rotates the token and triggers a gateway reload.
3. Minimum token length is enforced at install, rotation, and startup. Default policy is ≥73 characters; absolute floor is 64.
4. `MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true` is permitted only when the orchestrator container user cannot read the token file (EACCES). Default is `false` (fail-closed).

## Web session

1. Operator logs in with the bearer token at `/login`.
2. Web exchanges the token for an encrypted server-side session and returns an httpOnly `session` cookie.
3. The bearer token is never stored in the browser.
4. Mutating web routes require a matching CSRF token (`x-csrf-token`) bound to the active session.
5. Login route enforces per-IP rate limiting via `MYBRAIN_WEB_RATE_LIMIT_LOGIN`.

## Rate limiting

1. Orchestrator memory endpoints: fixed-window per-token limit via `MYBRAIN_RATE_LIMIT_PER_MIN` (default 60/min).
2. Gateway emits `429` on exhausted limits; repeated `401` indicates bad-token retries.
3. Request body size is bounded by `MYBRAIN_MAX_REQUEST_BODY_BYTES` (default 1 MiB).

## Non-goals

1. Internet exposure without TLS, stronger auth, or a WAF.
2. Multi-tenant isolation — a single deployment is scoped to one operator or trusted workstation.
