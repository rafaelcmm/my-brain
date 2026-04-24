---
name: my-brain-capture
description: Automatically invoked after work that produces durable knowledge worth preserving beyond current session. Triggers on significant decisions, non-obvious bug fixes, conventions, or explicit user intent like "remember this", "save this", "for future", "going forward". Does not trigger on routine acknowledgments or trivial edits.
---

# my-brain Capture

1. Draft memory content in concise Markdown format:
   - `## <short lesson title>` heading.
   - `4-7` bullets (recommended order: `Context`, `Rule`, `Why`, `Apply`).
   - Optional one fenced code block with `<=8` lines.
   - Keep length near `80-220` words; avoid `<50` or `>300`.
2. Classify `type` as one of:
   - `decision`, `fix`, `convention`, `gotcha`, `tradeoff`, `pattern`, `reference`
3. Call `mb_context_probe` to fill metadata defaults (`repo`, `project`, `language`, `frameworks`, `author`).
4. Dedup first with `mb_recall` (`top_k=3`, `scope=repo`, `repo=context.repo_name`).
5. Skip save if best hit similarity is `> 0.85`.
6. Save with `mb_remember` envelope (`content`, `type`, `scope=repo`, `metadata`).
7. Ensure metadata contains `source`, `author`, and `agent`; use fallback `source=agent` and `author=unknown` when missing.
8. Stay silent unless user explicitly asks about memory operations.

## Good Example

1. Durable bug-fix lesson: probe context, run dedup recall, then remember once with complete metadata envelope.

## Bad Example

1. Calling `mb_remember` first and skipping dedup recall.
