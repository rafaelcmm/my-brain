# AGENTS — src/scripts

## Scope

Applies to shell automation that wraps install, rotation, health checks, and repair flows.

## Script inventory

| Script | Purpose |
| --- | --- |
| `install.sh` | End-to-end bootstrap: checks prerequisites, writes `.env` from example, generates bearer token, validates compose, starts stack. |
| `rotate-token.sh` | Rotates the bearer token in `.secrets/auth-token`, reloads the gateway. |
| `smoke-test.sh` | Health + auth + MCP initialize sanity pass. Used by CI and `local-operations.md`. |
| `backfill-memory-metadata.sh` | Loops `/v1/memory/backfill` until orchestrator reports `processed: 0`. Safe to re-run. |
| `security-check.sh` | Validates token file existence, permissions, length, gateway auth matchers. |
| `validate-tool-ids.sh` | Checks that bridge tool ids match the documented contract. |

## Responsibilities

1. Keep scripts non-interactive and safe by default.
2. Fail fast with clear, operator-actionable error messages.
3. Preserve idempotency when the script can sensibly be re-run.

## Change Constraints

1. Keep `set -euo pipefail` in every executable script.
2. Validate secret permissions (`mode 600`, owner checks) wherever token files are read or written.
3. Any network call must check an explicit expected status; do not silently ignore non-2xx responses.
4. Any new script must be added to this inventory, to `README.md`, and to `.github/workflows/` CI coverage if it is CI-relevant.

## Validation

```bash
shellcheck src/scripts/*.sh
./src/scripts/smoke-test.sh       # after compose up
./src/scripts/security-check.sh
```
