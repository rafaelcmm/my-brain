# my-brain Architecture

This document describes runtime architecture for local my-brain deployments.

## Components

1. Gateway (Caddy): ingress auth, routing, header sanitization.
2. MCP bridge: streamable MCP endpoint and tool facade.
3. Orchestrator: REST API, runtime bootstrap, memory/learning services.
4. Postgres: durable storage for vectors and metadata.
5. Ollama: local LLM and embedding backends.
6. Web app (Next.js): authenticated operator UI for dashboard, memory workflows, query runner, and graph explorer.

## Data model

1. Vector memory remains managed by runtime engine internals.
2. Metadata sidecar table `my_brain_memory_metadata` stores scoped fields used by filtered recall.
3. ADR schemas `policy_memory`, `session_memory`, and `witness_memory` are created on orchestrator bootstrap.

## Request flow

1. Client calls gateway on `:3333/mcp` or `:8080/*` with bearer token.
2. Gateway validates token and strips `Authorization` before upstream.
3. MCP requests route to bridge; REST requests route to orchestrator/ollama.
4. Orchestrator coordinates model, vector, metadata, and learning paths.

## Web auth flow

1. User opens `/login` and submits bearer token to `POST /api/auth/login`.
2. Route validates token via orchestrator capabilities and creates encrypted server-side session.
3. Browser receives httpOnly `session` cookie; bearer token never stored client-side.
4. Protected routes resolve session server-side and proxy to orchestrator through composition ports.
5. Mutating web routes enforce CSRF token (`x-csrf-token`) and per-session rate limits.
6. `POST /api/auth/logout` destroys session and expires cookie.

## Web API endpoints

1. `GET /api/health`: web readiness endpoint used by compose healthcheck.
2. `POST /api/auth/login`: token-to-session exchange.
3. `POST /api/auth/logout`: session invalidation.
4. `POST /api/memory/create`: authenticated memory creation proxy.
5. `POST /api/memory/forget`: authenticated memory deletion proxy.
6. `POST /api/memory/query`: authenticated query runner (`mb_recall`, `mb_digest`, `mb_search`) with raw or processed query mode. Processed mode pins model `qwen3.5:0.8b` and returns `original_query` + `processed_query` metadata.

## Runtime modes

Single full runtime profile is supported. Degraded capability signaling is exposed through orchestrator capabilities APIs so clients can adjust trust level.

## Repository layout

1. `src/orchestrator/` — runtime process, HTTP API, memory and learning services.
2. `src/mcp-bridge/` — Streamable HTTP MCP facade over orchestrator tools.
3. `src/web/` — Next.js operator UI (dashboard, memory CRUD, query, graph).
4. `src/gateway/` — Caddy ingress, bearer auth, reverse proxy.
5. `src/db/` — database bootstrap SQL and schema init.
6. `src/scripts/` — install, rotate, smoke, security-check automation.
7. `postman/` — minimal sanity collection for MCP and LLM flows.
8. `.github/workflows/` — CI and release pipelines.
9. `docs/` — technical docs and runbooks.
10. `.claude/` — model-invoked skills and curator agent templates.

## Design constraints

1. Default bind host remains `127.0.0.1`.
2. Secrets remain local-only and never committed.
3. Public endpoint changes require matching updates in reference docs.
