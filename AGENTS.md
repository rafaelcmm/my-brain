# AGENTS

## Scope

This file governs whole repository unless subdirectory AGENTS.md overrides specific behavior.

## Purpose

my-brain is self-hosted memory and orchestration stack for MCP-capable clients.

## Global Rules

1. Keep localhost-safe defaults.
2. Never commit live secrets or tokens.
3. Keep user-facing docs in README.md and technical depth in docs/.
4. Prefer additive changes over destructive rewrites.

## Required Checks Before Completion

1. npm install
2. npm run lint
3. npm test
4. npx prettier --check .
5. docker compose config
6. scripts/smoke-test.sh (when stack is running)

## Documentation Contract

1. Update README.md for user-visible behavior changes.
2. Update docs/technical for implementation-level changes.
3. Document non-obvious logic intent in code comments.

## Security Guardrails

1. Keep .secrets directory mode 700 and secret files mode 600.
2. Keep Authorization header stripped before upstream services.
3. Keep bind host default on 127.0.0.1 unless explicitly changed.
