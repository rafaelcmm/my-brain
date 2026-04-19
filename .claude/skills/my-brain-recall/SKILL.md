---
name: my-brain-recall
description: Automatically invoked when user explicitly asks about prior project state or decision history, where memory content itself is expected answer. Triggers on phrases like "what did we decide", "why did we choose", "did we ever", "how did we solve", or direct historical lookup questions.
allowed-tools: mcp__my-brain__brain_search, mcp__my-brain__hooks_rag_context
---

# my-brain Recall

1. Query brain_search with top_k=10.
2. Filter matches by similarity above 0.6.
3. Sort by recency and tag groups.
4. Return concise memory facts, including conflicts when present.
5. If no match exists, clearly say no memory found and do not invent.
