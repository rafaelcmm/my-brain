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
