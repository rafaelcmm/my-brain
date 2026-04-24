---
description: Ensure durable memory capture quality, metadata completeness, dedup discipline, and correct scope selection.
paths:
	- "**"
---

# Memory Hygiene

## Durable capture criteria

Capture only durable items:

1. Significant decisions.
2. Non-obvious bug fixes.
3. Stable conventions and patterns.
4. Repeated gotchas with future reuse value.

Do not capture trivial acknowledgments, transient logs, or one-off noise.

## Dynamic similarity threshold

Use these thresholds for dedup and recall trust:

1. `0.6` when runtime engine is healthy (`engine=true`).
2. `0.85` when fallback mode is detected (`engine=false`).

## Mandatory sequencing

1. For capture workflows call `mb_context_probe` before any write.
2. Run dedup recall (`mb_recall`) before `mb_remember`.
3. Skip write when best similarity is `>0.85`.
4. Never bypass dedup even for explicit "remember this" requests.

## Scope policy

1. `repo`: file/function/build-specific facts.
2. `project`: product decisions spanning multiple repos.
3. `global`: language/framework facts with no repo dependency.

## Required metadata fields

Each memory should include:

1. `repo` / `repo_name` / `project`
2. `language`
3. `frameworks`
4. `tags`
5. `source` / `author` / `agent`

Missing fields must be derived from project context probe where possible.

If a field cannot be derived, provide explicit fallback values:

1. `source=agent`
2. `author=unknown`
3. `agent` from active runtime identity
