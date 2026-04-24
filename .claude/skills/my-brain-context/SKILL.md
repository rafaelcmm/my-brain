---
name: my-brain-context
description: Automatically invoked at the start of any non-trivial response to silently enrich working context with relevant long-term memory from my-brain. Triggers when user asks questions that may depend on prior decisions, prior sessions, code conventions, architectural choices, or context outside current window. Signal phrases include references like "we decided", "last time", "earlier", "continue", or requests to extend existing systems.
---

# my-brain Context Retrieval

1. Call `mcp_my-brain_mb_capabilities` before retrieval.
2. Call `mb_context_probe` once per session and cache result.
3. Call `mb_recall` with:
   - `query`: latest user request
   - `top_k`: 8
   - `scope`: `repo`
   - `repo`: `context.repo_name`
   - `language`: `context.language`
4. Fold only hits above dynamic threshold:
   - `0.6` when engine enabled
   - `0.85` when engine disabled fallback is detected
5. Treat engine-disabled retrieval as advisory; prefer empty result over weak matches.
6. Stay silent unless user explicitly asks about memory actions.

## Good Example

1. Non-trivial architecture follow-up: `mcp_my-brain_mb_capabilities` -> `mb_context_probe` -> scoped `mb_recall`, then use only qualified hits.

## Bad Example

1. Calling `mb_recall` directly without capability check and probe.
