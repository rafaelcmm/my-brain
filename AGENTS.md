# AGENTS

## Scope

This file governs the whole repository unless a subdirectory `AGENTS.md` overrides specific behavior.

## Purpose

my-brain is a self-hosted memory and orchestration stack for MCP-capable clients (Claude Code, Cursor, VS Code Copilot Chat). It ships five services via Docker Compose:

| Service                 | Path                | Role                                |
| ----------------------- | ------------------- | ----------------------------------- |
| `my-brain-db`           | `src/db/`           | Postgres with ruvector extension    |
| `my-brain-orchestrator` | `src/orchestrator/` | REST API, memory + learning runtime |
| `my-brain-mcp`          | `src/mcp-bridge/`   | Streamable HTTP MCP facade          |
| `my-brain-web`          | `src/web/`          | Next.js operator UI                 |
| `my-brain-gateway`      | `src/gateway/`      | Caddy ingress, bearer auth          |

All services are private except the gateway, which is the only surface bound to the host.

## API Contract Baseline

All successful `mb_*` responses are envelope-shaped in v2:

```json
{
  "success": true,
  "summary": "...",
  "data": {},
  "synthesis": { "status": "ok|fallback" }
}
```

Do not reintroduce per-request recall `mode`/`model` behavior.

## Toolchain

- **Package manager:** `pnpm@9.15.4` (declared in `package.json`). Do not use `npm` or `yarn`.
- **Workspaces:** `src/orchestrator`, `src/mcp-bridge` (the web app is not a workspace member; run its scripts from its directory).
- **Node:** matches what the orchestrator and web Dockerfiles install; stay on the installed major.

## Global Rules

1. Keep localhost-safe defaults. Never change `MYBRAIN_BIND_HOST` from `127.0.0.1` by default.
2. Never commit live secrets, tokens, or `.env`. `.secrets/` and `.env` are gitignored.
3. Keep user-facing landing content in `README.md` and technical depth in `docs/`.
4. Prefer additive changes over destructive rewrites. Apply Chesterton's Fence before removing guards or "dead" code.
5. Follow the hexagonal boundaries already in place: orchestrator and web keep domain logic independent from HTTP/infrastructure.

## Required Checks Before Completion

Run from the repo root:

```bash
pnpm install
pnpm lint
pnpm test
pnpm format:check
docker compose config
./src/scripts/smoke-test.sh      # after compose up
./src/scripts/security-check.sh  # validates auth token, permissions, config
```

The `smoke-test.sh` and `security-check.sh` scripts are mandatory when the change touches auth, rate limiting, the gateway, or the orchestrator runtime.

## Documentation Contract

Update the right file for the change class:

| Change class                                    | Target                                                   |
| ----------------------------------------------- | -------------------------------------------------------- |
| Feature or UX-visible behavior                  | `README.md`                                              |
| New or modified REST endpoint                   | `docs/technical/reference.md`                            |
| Env var addition or rename                      | `.env.example` **and** `docs/technical/configuration.md` |
| Architecture, component, or data-flow shift     | `docs/technical/architecture.md`                         |
| Auth, CSRF, token, or rate-limit change         | `docs/technical/security.md`                             |
| Operator workflow, troubleshooting, smoke steps | `docs/runbooks/local-operations.md`                      |
| Public API contract (request/response shape)    | Inline JSDoc/TSDoc on the handler **and** `reference.md` |

Never let code and docs drift within the same commit. Update both or neither.

## Security Guardrails

1. Keep `.secrets/` mode 700 and token files mode 600.
2. Keep the `Authorization` header stripped at the gateway before forwarding upstream.
3. Keep `MYBRAIN_INTERNAL_API_KEY` injected by the gateway on every internal hop.
4. Keep `MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=false` unless the orchestrator user truly cannot read the token file.
5. Keep bind host default on `127.0.0.1` unless the user has explicitly opted into wider exposure.

## Where to Find Things

- REST routes: `src/orchestrator/src/http/router.ts` → dispatches to `src/orchestrator/src/http/handlers/`.
- Web API routes: `src/web/src/app/api/*/route.ts`.
- Web server-side session + CSRF: `src/web/src/lib/infrastructure/session/`.
- Compose env defaults: `docker-compose.yml` (see `${MYBRAIN_*:-default}` fallbacks).
- Postman sanity flow: `postman/my-brain.postman_collection.json`.
