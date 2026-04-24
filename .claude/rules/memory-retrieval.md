---
description: Define safe memory retrieval behavior with metadata filters, empty-result honesty, and degraded-mode trust boundaries.
paths:
	- "**"
---

# Memory Retrieval

## Retrieval defaults

1. Prefer metadata filtering over global search.
2. Pass `repo` and `language` by default.
3. Use `scope=repo` unless user asks for cross-project recall.
4. For context enrichment, call tools in order: `mcp_my-brain_mb_capabilities` -> `mb_context_probe` -> `mb_recall`.

## Empty-result policy

1. Return empty results when no entry meets threshold.
2. Never pad with low-score unrelated memories.
3. Never fabricate missing history.

## Degraded-mode policy

When `engine=false`:

1. Treat memory results as advisory, not authoritative.
2. Apply high threshold (`>=0.85`).
3. Prefer no-context over noisy context.
4. Do not skip retrieval automatically when `engine=false`; enforce threshold instead.
