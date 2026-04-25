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
3. Build metadata using this exact order:
   - `mb_context_probe` output as primary defaults.
   - Runtime identity defaults (`agent`, `source`).
   - User-provided metadata merge (user values override defaults).
   - Normalize blanks (`""` or whitespace-only -> missing).
   - Apply fallback matrix.
4. Fallback matrix (required, non-empty after normalization):
   - `repo` from `context.repo`; else `context.repo_name`; else `unknown-repo`.
   - `project` from `context.project`; else `unknown`.
   - `language` from `context.language`; else `unknown`.
   - `frameworks` from `context.frameworks`; else `["unknown"]`.
   - `tags` from user/taxonomy; else `["memory"]`.
   - `source` from context/user; else `agent`.
   - `author` from context/user; else `unknown`.
   - `agent` from runtime identity; never blank.
5. Run pre-write metadata gate before dedup and remember:
   - Reject empty required scalars (`repo`, `project`, `language`, `source`, `author`, `agent`).
   - Reject non-array or empty arrays for `frameworks` and `tags`.
   - If gate fails after fallback, block `mb_remember` and repair metadata first.
6. Dedup with `mb_recall` (`top_k=3`, `scope=repo`, `repo=metadata.repo`, `language=metadata.language`).
7. Compute active dedup threshold from capabilities state:
   - `0.6` when `engine=true`
   - `0.85` when `engine=false` or capabilities are unavailable
8. Skip save if best hit similarity is above active dedup threshold.
9. Save with `mb_remember` (`content`, `type`, `scope=repo`) only after metadata gate pass; metadata must be attached through the runtime/server envelope before persistence.
10. Stay silent unless user explicitly asks about memory operations.
11. For envelope responses, read `.summary` for user-facing text, `.data` for scripting/automation, and `.synthesis` for fallback diagnostics (`status`, `error`).

## Good Example

1. Durable bug-fix lesson: probe context, normalize blanks, apply fallback matrix, pass validation gate, run dedup recall, then remember once with complete metadata envelope.

## Bad Example

1. Calling `mb_remember` with blank repo/project fields or skipping metadata gate.
