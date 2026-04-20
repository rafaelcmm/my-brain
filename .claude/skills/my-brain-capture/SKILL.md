---
name: my-brain-capture
description: Automatically invoked after work that produces durable knowledge worth preserving beyond current session. Triggers on significant decisions, non-obvious bug fixes, conventions, or explicit user intent like "remember this", "save this", "for future", "going forward". Does not trigger on routine acknowledgments or trivial edits.
allowed-tools: mcp__my-brain__mb_context_probe, mcp__my-brain__mb_recall, mcp__my-brain__mb_remember
---

# my-brain Capture

1. Distill durable lesson into 1-3 context-free sentences.
2. Classify `type` as one of:
   - `decision`, `fix`, `convention`, `gotcha`, `tradeoff`, `pattern`, `reference`
3. Call `mb_context_probe` to fill metadata defaults (`repo`, `project`, `language`, `frameworks`, `author`).
4. Dedup first with `mb_recall` (`top_k=3`, `scope=repo`, `repo=context.repo_name`).
5. Skip save if best hit similarity is `> 0.85`.
6. Save with `mb_remember` envelope (`content`, `type`, `scope=repo`, `metadata`).
7. Stay silent unless user explicitly asks about memory operations.
