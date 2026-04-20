# AGENTS

## Scope

Applies to src/db/ bootstrap SQL and migration-like changes.

## Responsibilities

1. Keep extension bootstrapping idempotent.
2. Avoid destructive SQL in init scripts.
3. Keep startup notices actionable for operators.

## Change Constraints

1. Never remove extension version pin without compatibility evidence.
2. Any SQL that changes learning behavior must include rationale comment.

## Validation

1. Bring stack up and verify SELECT ruvector_version(); succeeds.
