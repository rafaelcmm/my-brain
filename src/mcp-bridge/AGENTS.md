# AGENTS

## Scope

Applies to src/mcp-bridge container build and runtime bridge behavior.

## Responsibilities

1. Keep Streamable HTTP MCP bridge operational.
2. Ensure runtime includes both mcp-proxy and npx for ruvector MCP subprocess.
3. Keep command and allowed origins aligned with .env settings.

## Validation

1. docker build -f src/mcp-bridge/Dockerfile -t my-brain/mcp-bridge:local .
2. Verify tools/list returns HTTP 200 through gateway with bearer token.

## Test Strategy (C2 decision)

Bridge tests stay as `.mjs` driving compiled `dist/` output rather than converting
to `.test.ts`. Rationale: the integration tests spin up a real MCP subprocess and
test the HTTP contract end-to-end. Keeping them as `.mjs` avoids a circular
build dependency (tests would need TS compilation before running, but the compiled
output is what they test). The test runner is `node --test test/**/*.test.mjs`
executed after `pnpm build`.
