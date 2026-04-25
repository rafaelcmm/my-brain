---
description: Mandatory MCP tool trigger and ordering policy for my-brain skills and agents.
paths:
  - "**"
---

# MCP Tool Enforcement

## Purpose

This rule is mandatory for all my-brain memory workflows. It defines when MCP tools must be triggered, in what order, and when calls must be blocked.

## Canonical Tool Source

1. Canonical tool ids come from active MCP server tool index/catalog.
2. Skills and agents must reference only canonical ids plus explicit legacy allowlist entries.
3. Unknown or stale tool ids are blocking defects.

## Mandatory Trigger Matrix

1. Context enrichment for non-trivial requests
   - Trigger skill: `my-brain-context`
   - Required order: `mcp_my-brain_mb_capabilities` -> `mb_context_probe` -> `mb_recall`
2. Explicit historical lookup (decision history, prior fixes)
   - Trigger skill: `my-brain-recall`
   - Required order: `mb_context_probe` -> `mb_recall`
3. Durable lesson capture (decision, fix, convention, repeated gotcha)
   - Trigger skill: `my-brain-capture`
   - Required order: `mb_context_probe` -> `mb_recall` (dedup) -> `mb_remember`
4. User feedback on prior memory-guided result
   - Trigger skill: `my-brain-feedback`
   - Required order: `mb_vote`
5. Session lifecycle open/close
   - Trigger skill: `my-brain-session`
   - Required order: `mb_context_probe` -> `mb_session_open` and `mb_session_close` on completion cues
6. Periodic quality maintenance
   - Trigger agent: `my-brain-curator`
   - Required order: `mcp_my-brain_mb_capabilities` -> `mb_digest` -> `mb_recall`

## Degraded-Mode Enforcement

When `mcp_my-brain_mb_capabilities` reports `engine=false`:

1. Retrieval is allowed as advisory only.
2. Minimum threshold must be `>=0.85`.
3. Do not fabricate if no hit meets threshold.
4. Prefer empty result over low-confidence recall.

## Invocation Contracts

1. Retrieval calls must include scoped filters by default: `scope=repo`, `repo`, and `language` when available.
2. Capture calls must build metadata in this order: context probe -> runtime identity defaults -> user metadata merge -> blank normalization -> fallback matrix -> validation gate.
3. Capture calls must include metadata envelope fields whenever derivable: `repo`, `project`, `language`, `frameworks`, `tags`, `source`, `author`, `agent`.
4. Required non-empty contract before `mb_remember`:
   - Scalars: `repo`, `project`, `language`, `source`, `author`, `agent` must be non-empty strings after trim.
   - Arrays: `frameworks`, `tags` must be arrays with length `>=1`.
5. Fallback matrix defaults when missing after normalization:
   - `repo=unknown-repo`, `project=unknown`, `language=unknown`
   - `frameworks=[unknown]`, `tags=[memory]`
   - `source=agent`, `author=unknown`, `agent=<runtime-agent-id>`
6. Pre-write gate is mandatory: if required fields remain invalid after fallback, block write and repair metadata before `mb_remember`.
7. Dedup is mandatory before `mb_remember`; active threshold is `0.6` when `engine=true`, else `0.85` when `engine=false` or capabilities are unavailable.
8. Skip save when best hit similarity is above active dedup threshold.
9. `mb_remember` transport must remain executable: send `content`, `type`, and `scope`, and attach metadata through runtime/server envelope before persistence.
10. Tools must stay silent by default unless user explicitly asks about memory operations.
11. `mb_remember` content must use concise Markdown format:

- Heading `## <short lesson title>`
- `4-7` bullets (recommended: Context, Rule, Why, Apply)
- Optional one fenced code block with `<=8` lines
- Preferred length `80-220` words; compress if `>300`

## Validation Gate

Before finalizing customization changes:

1. Verify each `allowed-tools` or `tools` entry in `.claude/skills/*` and `.claude/agents/*` exists in catalog or allowlist.
2. Verify trigger descriptions contain concrete discovery phrases in "Use when" style.
3. Verify no rule/skill contradicts degraded-mode behavior.
4. Verify metadata pipeline order is consistent in all memory skills and rules.
5. Verify no capture path can call `mb_remember` before metadata gate pass.

## Good Examples

1. Good: Non-trivial request triggers `my-brain-context`, calls `mcp_my-brain_mb_capabilities` first, then probes context, then scoped recall.
2. Good: Capture flow runs dedup recall before remember and skips duplicate save at similarity `>0.85`.
3. Good: Session opens once, keeps `session_id` internal, closes on "done" cue.

## Bad Examples

1. Bad: Calling `mb_recall` before capability/context checks in context enrichment flow.
2. Bad: Skipping dedup and writing every lesson directly with `mb_remember`.
3. Bad: Using unknown tool id not present in catalog/allowlist.
4. Bad: Returning invented history when retrieval finds no qualifying memory.
