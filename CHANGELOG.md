# Changelog

All notable changes to this project are documented in this file.

## [2.0.1] - 2026-04-24

### Added

- Postman collection sections for `Aggregation` and `Session` REST coverage.
- MCP tool-call smoke flows for `mb_capabilities`, `mb_context_probe`, `mb_digest`, and `mb_vote`.
- Runbook synthesis debugging workflow with explicit `mb_synthesis_total{tool,status}` and `mb_synthesis_latency_ms` checks.

### Changed

- Postman top-level sections now align with v2 release checklist: `Smoke`, `Memory lifecycle (REST)`, `Aggregation`, `Session`, `MCP tools`.
- my-brain `.claude` skills now explicitly instruct envelope parsing: `.summary` for user-facing text and `.data` for scripting.

## [2.0.0] - 2026-04-24

### Added

- v2 synthesis envelope contract for successful tool responses: `success`, `summary`, `data`, `synthesis`.
- Orchestrator integration coverage for synthesis fallback behavior on `mb_*` endpoints.
- Prompt template hardening tests and newline sanitization safeguards.
- Optional Newman execution in smoke test script when available.
- Web envelope-first domain/port/client/use-case stack and summary-first query UX.

### Changed

- Web APIs now reject legacy recall `mode`/`model` inputs.
- Dashboard capabilities rendering moved to boolean capability pills.
- Orchestrator response utility now accepts typed envelope payloads cleanly.
- Technical and runbook docs aligned to v2 behavior and env readers.

### Removed

- Legacy recall mode/model toggles and `mb_search` query path from web operator UX.
- Legacy processed/raw response assumptions in web tests.
- Legacy references to processed model behavior in active test coverage.

## [1.0.0] - 2025-03-15

- Initial stable release baseline.
