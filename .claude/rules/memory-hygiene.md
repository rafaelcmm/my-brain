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

## Memory content format (mandatory)

All captured memories must use concise Markdown.

Required shape:

1. Heading: `## <short lesson title>`.
2. Body: `4-7` bullets, one idea per bullet.
3. Optional code block: at most one fenced block with `<=8` lines.
4. Keep wording context-free so the note is reusable across sessions.

Length target:

1. Preferred: `80-220` words.
2. Too short: `<50` words is usually not durable.
3. Too long: `>300` words must be compressed before save.

Bullet schema (recommended order):

1. `- Context:` where this applies.
2. `- Rule:` decision/fix/pattern to follow.
3. `- Why:` rationale or failure mode.
4. `- Apply:` concrete trigger or reuse cue.

Avoid:

1. Single-line vague notes.
2. Long narrative prose.
3. Environment-specific noise that will age poorly.

## Dynamic similarity threshold

Use these thresholds for dedup and recall trust:

1. `0.6` when runtime engine is healthy (`engine=true`).
2. `0.85` when fallback mode is detected (`engine=false`).

## Mandatory sequencing

1. For capture workflows call `mb_context_probe` before any write.
2. Run dedup recall (`mb_recall`) before `mb_remember`.
3. Skip write when best similarity is above active threshold (`0.6` healthy, `0.85` degraded).
4. Never bypass dedup even for explicit "remember this" requests.

## Scope policy

1. `repo`: file/function/build-specific facts.
2. `project`: product decisions spanning multiple repos.
3. `global`: language/framework facts with no repo dependency.

## Required metadata fields

Each memory should include:

1. `repo` and `project` (with `repo_name` allowed only as upstream probe source)
2. `language`
3. `frameworks`
4. `tags`
5. `source` / `author` / `agent`

Missing fields must be derived from project context probe where possible.

If a field cannot be derived, provide explicit fallback values:

1. `source=agent`
2. `author=unknown`
3. `agent` from active runtime identity

## Metadata normalization and fallback contract

Before dedup or save, normalize and validate metadata in this order:

1. Build defaults from `mb_context_probe`.
2. Merge runtime identity (`agent`, `source`) and user metadata.
3. Normalize blanks (`""` and whitespace-only strings are missing).
4. Apply fallback values.
5. Enforce non-empty validation gate.

Required non-empty fields after fallback:

1. Scalars: `repo`, `project`, `language`, `source`, `author`, `agent`.
2. Arrays: `frameworks`, `tags` must have at least one item.

Fallback matrix (deterministic defaults):

1. `repo = context.repo || context.repo_name || "unknown-repo"`
2. `project = context.project || "unknown"`
3. `language = context.language || "unknown"`
4. `frameworks = context.frameworks || ["unknown"]`
5. `tags = user.tags || ["memory"]`
6. `source = context.source || "agent"`
7. `author = context.author || "unknown"`
8. `agent = runtime_agent_id`

If validation still fails after fallback, block `mb_remember` and repair metadata first.
