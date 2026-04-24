<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# AGENTS — src/web

## Scope

Applies to the Next.js operator UI: pages, API routes, auth, composition layer, orchestrator client.

## Architecture (hexagonal)

- `src/app/` — Next.js App Router pages and `api/*/route.ts` handlers.
- `src/lib/application/` — use cases (one file per operation). Pure; no HTTP, no Next.js imports.
- `src/lib/infrastructure/` — adapters: orchestrator HTTP client, session store, CSRF.
- `src/lib/composition/` — dependency wiring that hands adapters to use cases.
- `src/lib/config/env.ts` — Zod-validated env loader. All env access must go through this.

Keep `application/` free of `next`, `react`, `fetch`, or any infra import. Only adapters call HTTP.

## Security invariants (do not break)

1. The bearer token is never stored in the browser — exchanged for an encrypted server-side session on `POST /api/auth/login`.
2. Every mutating API route verifies a CSRF token bound to the active session (`x-csrf-token` header).
3. Every authenticated response sets `Cache-Control: no-store`.
4. `MYBRAIN_INTERNAL_API_KEY` is server-only; it must never reach a React Server Component's client payload.
5. Route handlers validate inputs with Zod before calling the orchestrator.

## Change Constraints

1. Any new protected route must verify the session before reading user-visible data.
2. Any new mutating route must require the CSRF token and enforce `no-store`.
3. Any new env var must be added to `src/lib/config/env.ts` (Zod schema), `.env.example`, and `docs/technical/configuration.md`.
4. Orchestrator responses are parsed through DTOs in `src/lib/infrastructure/orchestrator/dtos/` — no `as` casts.
5. Use cases return typed results; adapters map orchestrator payloads to domain shapes in `mappers/`.

## Validation

Run from `src/web`:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Build must succeed with zero type errors and no ESLint warnings surfaced via `next build`.
