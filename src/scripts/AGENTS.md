# AGENTS

## Scope

Applies to src/scripts/ shell automation.

## Responsibilities

1. Keep scripts non-interactive and safe by default.
2. Fail fast with clear errors.
3. Preserve idempotency when possible.

## Change Constraints

1. Keep set -euo pipefail in every executable script.
2. Validate secret permissions where token files are handled.
3. Any network call must have explicit expected status checks.

## Validation

1. shellcheck src/scripts/\*.sh
2. src/scripts/smoke-test.sh after compose up
