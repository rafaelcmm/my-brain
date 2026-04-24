# AGENTS

## Scope

Applies to .claude/ skills and agents.

## Responsibilities

1. Keep skills model-invoked with trigger-oriented descriptions.
2. Restrict allowed-tools to minimum set.
3. Keep silent-memory behavior by default.
4. Enforce deterministic MCP tool ordering for memory workflows.

## Change Constraints

1. Avoid user-invocable flags unless explicitly requested.
2. Update skill descriptions when trigger behavior drifts.
3. Load `memory-hygiene`, `memory-retrieval`, and `mcp-tool-enforcement` rules for memory workflows.
4. Treat active MCP server tool index/catalog as canonical tool-id source.
