# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog and semantic versioning rules.

## [Unreleased]

### Changed

- **[orchestrator] TypeScript Migration**: Complete refactor from single 2666-line `.mjs` monolith to modular TS architecture (hexagonal layers: domain → application → infrastructure → HTTP).
- **[orchestrator] Router Refactoring**: HTTP router split from 1046 lines to 338-line dispatcher + 6 handler modules (~155-195 lines each) per objective-files rule. Handlers: memory-write, memory-recall, memory-vote, memory-forget, session, memory-digest.
- **[orchestrator] Router Context Extraction**: Shared types (`Capabilities`, `RouterContext`, `getCapabilities`, `getDefaultRecallThreshold`) extracted to dedicated `router-context.ts` to break circular imports and improve modularity.
- **[orchestrator] Build Pipeline**: Added TypeScript compiler stage to Dockerfile; orchestrator now compiles `src/` → `dist/` via `pnpm build` before Docker image creation.
- **[all] tsconfig Alignment**: Root `tsconfig.json` with strict settings added; bridge and orchestrator now extend shared base with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `NodeNext`.
- **[security] Session Rate Limiting**: POST /v1/session/open and POST /v1/session/close now enforce rate-limiting to prevent session churn attacks.

### Added

- **[orchestrator] HTTP Handlers Module**: New `src/orchestrator/src/http/handlers/` directory with per-route handler functions (memory-write.ts, memory-recall.ts, memory-vote.ts, memory-forget.ts, session.ts, memory-digest.ts).
- **[all] Unit Tests**: Comprehensive test suites for orchestrator and bridge; 24/24 passing (22 orchestrator, 2 bridge). Tests cover HTTP routing, auth gating, validation, and domain logic.
- **[orchestrator] Integration Tests**: New `src/orchestrator/test/integration/postgres-memory.integration.test.ts` with ephemeral Postgres via `docker-compose.test.yml` on port 5433.
- **[orchestrator] Docker Integration**: `docker-compose.test.yml` with ephemeral Postgres for CI integration tests.
- **[orchestrator] Documentation**: Complete docblock coverage for all new/changed exports per commenting-standards.

### Fixed

- **[orchestrator] Dockerfile Build**: Now includes compilation stage; previously attempted to run raw `.ts` files without compilation.
- **[technical] Circular Import**: Resolved by extracting RouterContext and helper functions to router-context.ts module.
