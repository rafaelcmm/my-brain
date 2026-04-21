# AGENTS

## Scope

Applies to CI/CD workflow and release automation files.

## Responsibilities

1. Keep workflows deterministic and minimal privilege.
2. Keep CI coverage aligned with runtime-critical artifacts.
3. Keep release automation semver-driven via git tags (v\*) and release workflow.

## Change Constraints

1. Pin major action versions at minimum.
2. Do not add secret-bearing logs.
3. Keep release workflow producing multi-arch images and provenance attestation.

## Validation

1. Validate workflow YAML syntax.
2. Ensure CI jobs cover lint, test, compose config, Caddy validate, shellcheck.
