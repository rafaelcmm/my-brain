# AGENTS

## Scope

Applies to gateway/ reverse-proxy and auth behavior.

## Responsibilities

1. Enforce bearer token at ingress for both MCP and REST.
2. Preserve streaming behavior for MCP endpoint.
3. Strip Authorization header before upstream forwarding.

## Change Constraints

1. Any auth matcher change requires negative and positive curl tests.
2. Keep WWW-Authenticate header on 401 responses.
3. Keep Caddyfile valid under caddy validate.

## Validation

1. docker run --rm -v "$PWD/gateway:/etc/caddy" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
