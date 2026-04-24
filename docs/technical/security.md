# Security (v2)

## Boundary Model

- External clients authenticate at gateway with bearer token file secret.
- Gateway strips external `Authorization` before proxying upstream.
- Gateway injects `MYBRAIN_INTERNAL_API_KEY` for internal trust chain.
- Orchestrator verifies internal key plus optional bearer requirement.

## Required Defaults

- Keep `MYBRAIN_BIND_HOST=127.0.0.1` unless explicit exposure needed.
- Keep `MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=false` by default.
- Keep `.secrets/` mode `700`; token files mode `600`.

## Input and Abuse Controls

- Request body size limits enforced by orchestrator bootstrap.
- JSON schema validation on inbound tool payloads.
- Endpoint-specific rate limiting before synthesis execution.
- No client-controlled mode/model toggles for recall synthesis.

## Synthesis Hardening

- Prompt templates sanitize and compact user-provided snippets.
- Timeout and abort semantics prevent hanging synthesis calls.
- Fallback envelope preserves `data` when synthesis unavailable.

## Operational Checks

Run before release or after auth changes:

```bash
./src/scripts/security-check.sh
./src/scripts/smoke-test.sh
```

Verify:

- Unauthorized requests rejected.
- Internal key required where expected.
- Gateway header stripping behavior intact.
- Rate-limit counters increment and 429 path blocks synthesis execution.
