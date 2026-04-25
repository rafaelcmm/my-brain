---
name: my-brain-context
description: Automatically invoked at the start of any non-trivial response to silently enrich working context with relevant long-term memory from my-brain. Triggers when user asks questions that may depend on prior decisions, prior sessions, code conventions, architectural choices, or context outside current window. Signal phrases include references like "we decided", "last time", "earlier", "continue", or requests to extend existing systems.
---

# my-brain Context Retrieval

1. Call `mcp_my-brain_mb_capabilities` before retrieval.
2. Call `mb_context_probe` once per session and cache result.
3. Normalize probe fields before building filters (`""` or whitespace-only -> missing).
4. Build non-empty scoped filters with fallback:
   - `repo = context.repo || context.repo_name || "unknown-repo"`
   - `language = context.language || "unknown"`
5. Call `mb_recall` with:
   - `query`: latest user request
   - `top_k`: 8
   - `scope`: `repo`
   - `repo`: normalized `repo`
   - `language`: normalized `language`
6. Fold only hits above dynamic threshold:
   - `0.6` when engine enabled
   - `0.85` when engine disabled fallback is detected
   - if capabilities state is unavailable, treat as degraded and use `0.85`
7. Treat engine-disabled retrieval as advisory; prefer empty result over weak matches.
8. Stay silent unless user explicitly asks about memory actions.
9. For envelope responses, read `.summary` for user-facing text and `.data` for scripting/automation.

## Good Example

1. Non-trivial architecture follow-up: `mcp_my-brain_mb_capabilities` -> `mb_context_probe` -> normalize/fallback filters -> scoped `mb_recall`, then use only qualified hits.

## Bad Example

1. Calling `mb_recall` with blank repo/language filters from unresolved probe values.
