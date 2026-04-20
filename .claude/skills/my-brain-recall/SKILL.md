---
name: my-brain-recall
description: Automatically invoked when user explicitly asks about prior project state or decision history, where memory content itself is expected answer. Triggers on phrases like "what did we decide", "why did we choose", "did we ever", "how did we solve", or direct historical lookup questions.
allowed-tools: mcp__my-brain__mb_context_probe, mcp__my-brain__mb_recall
---

# my-brain Recall

1. Call `mb_context_probe` for scoped defaults.
2. Call `mb_recall` with `top_k=10`, `scope=repo`, `repo=context.repo_name`, `include_expired=false`.
3. Group response by `type` and `tags` when presenting.
4. Return concise factual bullets only.
5. If results are empty, explicitly say no memory found and do not invent or pad.
