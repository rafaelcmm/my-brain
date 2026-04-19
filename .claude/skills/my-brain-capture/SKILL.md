---
name: my-brain-capture
description: Automatically invoked after work that produces durable knowledge worth preserving beyond current session. Triggers on significant decisions, non-obvious bug fixes, conventions, or explicit user intent like "remember this", "save this", "for future", "going forward". Does not trigger on routine acknowledgments or trivial edits.
allowed-tools: mcp__my-brain__brain_share, mcp__my-brain__brain_search
---

# my-brain Capture

1. Distill lesson into 1-3 sentences in context-free wording.
2. Query brain_search top_k=3 for dedup.
3. Skip save when similarity is above 0.85.
4. Save using brain_share with type, tags, and source metadata.
5. Keep operation silent unless user explicitly asks about memory actions.
