# my-brain Web App

Next.js operator UI for the my-brain stack.

## Development

```bash
pnpm dev
```

Default local URL: `http://localhost:3000`.

## Query API Contract (v2)

The web app query runner proxies only two tools:

- `mb_recall`
- `mb_digest`

All tool responses are envelope-shaped:

```json
{
  "success": true,
  "summary": "Human-readable synthesis",
  "data": { "...": "raw payload" },
  "synthesis": {
    "status": "ok",
    "model": "qwen3.5:0.8b",
    "latency_ms": 120
  }
}
```

UI behavior:

- Summary card renders `summary` when present.
- Parsed tab renders `data` as source-of-truth.
- Raw tab renders the full request/response envelope.

## Important v2 Rules

- No client-selectable query mode.
- No client-selectable model.
- Synthesis is always server-side in orchestrator.

## Validation Commands

```bash
pnpm lint
pnpm typecheck
pnpm test -- --run
```
