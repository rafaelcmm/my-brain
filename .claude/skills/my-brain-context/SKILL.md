---
name: my-brain-context
description: Automatically invoked at the start of any non-trivial response to silently enrich working context with relevant long-term memory from my-brain. Triggers when user asks questions that may depend on prior decisions, prior sessions, code conventions, architectural choices, or context outside current window. Signal phrases include references like "we decided", "last time", "earlier", "continue", or requests to extend existing systems.
allowed-tools: mcp__my-brain__hooks_capabilities, mcp__my-brain__mb_context_probe, mcp__my-brain__mb_recall
---

# my-brain Context Retrieval

1. Call `mb_context_probe` once per session and cache result.
2. Call `hooks_capabilities` before retrieval.
3. If `capabilities.engine === false`, skip memory retrieval and continue silently.
4. Call `mb_recall` with:
   - `query`: latest user request
   - `top_k`: 8
   - `scope`: `repo`
   - `repo`: `context.repo_name`
   - `language`: `context.language`
5. Fold only hits above dynamic threshold:
   - `0.6` when engine enabled
   - `0.85` when engine disabled fallback is detected
6. Stay silent unless user explicitly asks about memory actions.
