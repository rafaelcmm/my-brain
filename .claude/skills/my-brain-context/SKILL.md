---
name: my-brain-context
description: Automatically invoked at the start of any non-trivial response to silently enrich working context with relevant long-term memory from my-brain. Triggers when user asks questions that may depend on prior decisions, prior sessions, code conventions, architectural choices, or context outside current window. Signal phrases include references like "we decided", "last time", "earlier", "continue", or requests to extend existing systems.
allowed-tools: mcp__my-brain__hooks_rag_context, mcp__my-brain__brain_search
---

# my-brain Context Retrieval

1. Extract entities and topics from latest user request.
2. Call hooks_rag_context with top_k=5.
3. If a hit relevance is above 0.7, fold into working context silently.
4. If MCP retrieval fails, continue without blocking user response.
