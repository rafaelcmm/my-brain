---
name: my-brain-self-learning
version: 1.0.0
description: Use the my-brain MCP server to run query, feedback, and learn loops so answers improve over time.
---

# my-brain Self-Learning Skill

## Purpose

Use this skill when an LLM assistant has access to the my-brain MCP server and should continuously improve retrieval quality from explicit feedback.

## Required Tools

- query
- feedback
- learn

## Core Workflow

1. Call query with user intent text and topK.
2. Use returned interactionId while generating final answer.
3. After user reaction is known, call feedback with qualityScore.
4. Call learn in key moments to consolidate updates.

## Quality Score Guide

- 0.9 to 1.0: answer was clearly correct and useful.
- 0.6 to 0.8: partially useful, minor issues.
- 0.2 to 0.5: weak answer, needs improvement.
- 0.0 to 0.1: wrong or harmful answer.

## When To Force Learning

Call learn immediately after:

- repeated negative feedback on same topic
- major correction from user
- completion of important workflow (incident fix, release decision)
- batch of at least 5 feedback events

## Minimal Tool Patterns

### Query

Input:

```json
{ "text": "How do I rotate API keys safely?", "topK": 5 }
```

### Feedback

Input:

```json
{
  "interactionId": "<id-from-query>",
  "qualityScore": 0.95,
  "route": "ops-security",
  "forceLearnAfterFeedback": true
}
```

### Learn

Input:

```json
{}
```

## Safety Rules

- Never skip feedback for high-impact answers.
- Never fabricate feedback. Use real user or evaluator signals.
- Keep qualityScore bounded to [0, 1].
- If interactionId missing, do not submit feedback; run a new query first.
