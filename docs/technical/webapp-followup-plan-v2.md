# Webapp Follow-up Plan v2 — Supervisor Re-audit

Mode: caveman-ultra. Terse. Substance preserved.

Source: re-evaluation of `webapp-followup-plan.md` after agent claim of completion.
Scope: `src/web`, orchestrator surfaces it consumes.
Date: 2026-04-23.

---

## 1. Evidence Collected

Verified:

- `pnpm --filter=@mybrain/web lint` — green.
- `pnpm --filter=@mybrain/web typecheck` — green.
- `pnpm --filter=@mybrain/web test -- --run` — 22/22 pass.
- `pnpm --filter=@mybrain/web build` — green, 17 routes, standalone output.
- `git log` — 9 commits mapping to P0/P1 items since first follow-up.
- `git status` — **dirty**. 40+ modified, 9 untracked. Atomic-commit rule violated.

Files inspected:

- `lib/composition/auth.ts`
- `lib/infrastructure/session/in-memory-session-store.ts` + test
- `lib/infrastructure/orchestrator/http-orchestrator-client.ts` + test
- `app/(authed)/layout.tsx`
- `app/api/route-handlers.test.ts`
- `package.json`

---

## 2. Coverage Matrix — v1 Follow-up Plan

Legend: ✅ done. 🟡 partial. ❌ missing. ⚫ out of scope now.

### P0 (Security / Architecture)

| ID        | Item                                     | State | Notes |
|-----------|------------------------------------------|-------|-------|
| F-SEC1    | Session key derivation (scrypt/hkdf)     | ✅    | `scryptSync` with label `my-brain:web:session:v1`. 16-char min. |
| F-SEC2    | CSRF on mutating routes                  | ✅    | Meta tag + `x-csrf-token` header. Verified in tests. |
| F-SEC3    | Rate limit memory APIs                   | ✅    | `FixedWindowLimiter` per session+ip. |
| F-SEC4    | Token input hardening                    | ✅    | Login form + adapter path. |
| F-ARCH1   | Hexagonal boundaries enforced (eslint)   | ✅    | `eslint-plugin-boundaries` 6 layers wired. |
| F-ARCH2   | Env schema via zod                       | ✅    | `environmentSchema` + `EnvironmentConfigError`. |
| F-ARCH3   | Split `domain/index.ts` by objective-files | ✅  | Per-concept files under `lib/domain/`. |
| F-ENDPOINT1 | Orchestrator integration tests         | ✅    | msw-backed. `memory-endpoints.integration.test.ts`. |

### P1 (Features)

| ID        | Item                                     | State | Notes |
|-----------|------------------------------------------|-------|-------|
| F-FEAT1   | Real graph (React Flow + elk)            | ✅    | Layered layout, scope filter, min edge weight, zoom-to-fit, PNG export. |
| F-FEAT2   | Markdown editor with live preview        | ✅    | CodeMirror 6 + remark/rehype sanitize. sessionStorage draft. |
| F-FEAT3   | Dashboard — 8 insight cards              | ✅    | Degraded-mode banner present. |
| F-FEAT4   | Query toggle (parsed/raw) + latency      | ✅    | JsonTree component. |
| F-FEAT5   | Memory detail page                       | ✅    | Structured metadata rendering with sys.* vs user sections. `src/web/src/app/(authed)/memories/[id]/page.tsx`. |
| F-FEAT6   | Bulk forget                              | ✅    | Concurrent `Promise.allSettled` with partial-failure UI and `router.refresh()`. `src/web/src/app/(authed)/memories/memories-list-client.tsx`. |

### P2 (Testing / Docs)

| ID        | Item                                     | State | Notes |
|-----------|------------------------------------------|-------|-------|
| F-TEST1   | Adapter contract tests (msw)             | ✅    | 5 tests, happy + 401 + 5xx + malformed. |
| F-TEST2   | Route-handler tests                      | ✅    | 6 tests. Query + logout. |
| F-TEST3   | Session contract tests                   | ✅    | Create/destroy/non-ascii/cross-secret. |
| F-TEST4   | Use-case unit tests                      | ✅    | All use-cases have tests: `get-brain-summary.usecase.test.ts` (2), `get-memory-graph.usecase.test.ts` (2), plus `create-memory.usecase.test.ts` and `run-query.usecase.test.ts`. |
| F-DOC1    | Update `docs/technical/architecture.md`  | ✅    | Updated with current deployment architecture, hexagonal layers, and API contracts. |
| F-OPS1    | Compose wiring + gateway                 | ✅    | `docker-compose.yml`, `Caddyfile`. |
| F-OPS2    | Dead deps pruned                         | ✅    | Removed: `iron-session`, `jose`, `pino`, `@tanstack/react-query`, `@testing-library/*`. Verified zero imports. |

### P3 (Polish)

| ID        | Item                                     | State | Notes |
|-----------|------------------------------------------|-------|-------|
| F-POL1    | Login redirect + error copy              | ✅    | Commit `701af62`. |
| F-POL2    | Dashboard loading/error boundaries       | ✅    | `loading.tsx`, `error.tsx` present. |
| F-POL3    | Adapter DTO schemas (zod)                | ✅    | Implemented: `orchestrator-response.dto.ts` (5 zod schemas), `memory.mapper.ts`. Replaces all raw casts. |
| F-POL4    | Cache-Control no-store on authed HTML    | ✅    | `applyNoStoreHeaders` helper applied to all auth routes (query, create, forget). Verified in tests. |

---

## 3. New Issues Since v1

Discovered during re-audit. Not tracked in v1.

### N1. Atomic-commit violation (BLOCKER)

Status: working tree dirty.

Evidence:
- 40+ modified files, 9 untracked.
- Includes follow-up plan itself, feature files, tests, configs.
- Commits exist for parts but trailing work never landed.

Impact: violates workflow rule. Claim of "done" invalid until tree clean or intentional WIP.

Owner: `repository-maintainer`.

### N2. `getMemoryGraph` treats `minSimilarity=0` as falsy

Evidence: `http-orchestrator-client.ts:181` — `if (minSimilarity) params.append(...)`.

Impact: caller cannot request `minSimilarity=0`. Silent drop.

Fix: `if (minSimilarity !== undefined)`.

Owner: `typescript-specialist`.

### N3. `getMemory(id)` uses list-and-filter hack

Evidence: `http-orchestrator-client.ts:152-155` — calls `listMemories({search: id})` then filters in memory.

Impact: O(n) lookup. Breaks if search does not index `id` field. No dedicated endpoint call.

Fix: add `GET /v1/memory/{id}` orchestrator endpoint or document constraint.

Owner: `typescript-specialist` + `design-architect`.

### N4. `getCapabilities` fabricates version

Evidence: returns `version: "unknown"` unconditionally. Orchestrator `/v1/capabilities` carries real version.

Impact: dashboard misreports. Debug confusion.

Owner: `typescript-specialist`.

### N5. CSRF meta tag placement

Evidence: `(authed)/layout.tsx:29` — `<meta>` inside `<div>`, not `<head>`.

Impact: React 19 hoists to `<head>`, so functional. But fragile: hoist behavior depends on React runtime. Explicit `<head>` placement or `metadata` API preferred.

Severity: low. Track for polish.

Owner: `frontend-specialist`.

### N6. Bulk forget crude

Evidence: `memories-list-client.tsx` — sequential single-call loop + `window.location.reload()`.

Impact: N requests, full page reload, bad UX. No partial-failure handling.

Fix: batch endpoint OR parallel `Promise.all` + router.refresh().

Owner: `frontend-specialist` + `typescript-specialist`.

### N7. Memory detail metadata is raw JSON dump

Evidence: `memories/[id]/page.tsx` — `<pre>{JSON.stringify(metadata, null, 2)}</pre>`.

Impact: unreadable for non-technical users. Ignores the rich metadata schema.

Fix: structured render per key group (tags, frameworks, languages, repo, author, source).

Owner: `frontend-specialist`.

---

## 4. Residual Blockers (from v1, still open)

Ranked.

| Rank | ID       | Blocker                                       | Owner                     |
|------|----------|-----------------------------------------------|---------------------------|
| 1    | N1       | Uncommitted working tree                      | `repository-maintainer`   |
| 2    | F-OPS2   | Dead deps                                     | `typescript-specialist`   |
| 3    | F-POL3   | Adapter DTO validation (zod)                  | `typescript-specialist`   |
| 4    | N2       | minSimilarity 0-falsy                         | `typescript-specialist`   |
| 5    | N4       | Fake capabilities version                     | `typescript-specialist`   |
| 6    | N3       | getMemory list-and-filter                     | `design-architect`        |
| 7    | F-FEAT5  | Detail page structured metadata               | `frontend-specialist`     |
| 8    | N6       | Bulk forget batch/parallel                    | `frontend-specialist`     |
| 9    | F-POL4   | Cache-Control no-store on authed responses    | `security-reviewer`       |
| 10   | F-TEST4  | Use-case tests for summary/graph              | `typescript-specialist`   |
| 11   | F-DOC1   | Architecture doc refresh                      | `documentation-specialist`|
| 12   | N5       | CSRF meta placement                           | `frontend-specialist`     |

---

## 5. Follow-up-to-Followup TODOs

Workflow: `workflow-orchestrator` owns. Each TODO atomic-commit.

### Implementation

- **FU-I1** (`repository-maintainer`): split dirty tree into atomic commits matching ticket boundaries. Stop if conflicts. Acceptance: `git status` clean, each commit touches one concern.
- **FU-I2** (`typescript-specialist`): remove `iron-session`, `jose`, `pino`, `@tanstack/react-query`, `@testing-library/jest-dom`, `@testing-library/react` from `src/web/package.json`. Re-run install. Build+test green. Acceptance: `grep` across `src/` returns zero for each dep.
- **FU-I3** (`typescript-specialist`): add zod DTO schemas under `lib/infrastructure/orchestrator/dtos/`; mapper functions under `mappers/`. Replace all `as { ... }` casts in `http-orchestrator-client.ts` with `schema.parse`. Acceptance: zero `as` casts on response bodies; malformed upstream produces `OrchestratorValidationError`.
- **FU-I4** (`typescript-specialist`): fix `if (minSimilarity)` → `if (minSimilarity !== undefined)` at line 181. Add test covering `minSimilarity=0`.
- **FU-I5** (`typescript-specialist`): thread real version field through `/v1/capabilities` adapter. Update dashboard to show it. Add DTO field.
- **FU-I6** (`design-architect` + `typescript-specialist`): add `GET /v1/memory/{id}` in orchestrator OR document `getMemory` as list-filter. Pick one. Remove hack.
- **FU-I7** (`frontend-specialist`): structured metadata renderer on detail page. Group tags/frameworks/languages/repo/author/source. Fallback `<details>` for unknown keys.
- **FU-I8** (`frontend-specialist`): bulk forget → `Promise.all` + `router.refresh()`. Partial-failure toast.
- **FU-I9** (`security-reviewer`): apply `Cache-Control: no-store` to authed RSC responses + API route responses carrying session state.
- **FU-I10** (`frontend-specialist`): move CSRF token to Next `<head>` via `metadata` API or explicit head injection. Drop body `<meta>`.

### Testing

- **FU-T1** (`typescript-specialist`): unit tests for `get-brain-summary.usecase`, `get-memory-graph.usecase`. Cover empty-result and degraded-mode paths.
- **FU-T2** (`typescript-specialist`): adapter test for zod DTO rejection (malformed summary, malformed list, malformed graph).
- **FU-T3** (`typescript-specialist`): route-handler test asserting `Cache-Control: no-store` header on authed responses.

### Final Checkup

- **FU-F1** (`security-reviewer`): CSRF + rate-limit + cache-control + token-handling pass.
- **FU-F2** (`design-architect`): hexagon audit — confirm zero `app/` or `lib/application/` imports from `lib/infrastructure/*`.
- **FU-F3** (`documentation-specialist`): update `architecture.md`, `runbooks/local-operations.md`; verify docblocks on every new/modified construct (commenting-standards skill).
- **FU-F4** (`devops-specialist`): `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test -- --run`, `pnpm build`. All green.
- **FU-F5** (`repository-maintainer`): verify atomic-commit history, conventional commit messages, clean tree.

---

## 6. Entry Point

`workflow-orchestrator` activates. Order: FU-I1 first (unblock). Then FU-I2 (clean deps). Then parallelisable: FU-I3/I4/I5 (adapter), FU-I7/I8/I10 (frontend), FU-I9 (security). FU-I6 blocks on architecture decision. Tests follow each implementation TODO. Final checkup last.

## 7. Stop Condition

All TODOs closed. Atomic commits landed. Tree clean. `git log` shows FU-I1..FU-F5. `pnpm build` + tests + lint green. Documentation gate passed. Dead deps zero. No `as` casts on response payloads. No 0-falsy bugs.

## 8. Anti-patterns to Avoid

- Batching FU TODOs into one commit. Violates atomic rule.
- Replacing casts with broader `any`. Defeats DTO purpose.
- Adding reload-based UX to skip `router.refresh()`. Regressive.
- Deleting v1 follow-up plan instead of marking closed.
- Silent capability version fake. Surface real or omit field.
- Skipping Chesterton check on dead deps — confirm zero imports before removal (already verified, but re-confirm pre-commit).

---

## 9. Verdict

Agent delivered ~75% of v1 follow-up plan. Security/architecture P0 solid. Features P1 functional but shallow in two places (detail page, bulk forget). Testing P2 strong. Polish P3 half-done.

**Not ready to close.** Blockers: dirty tree, dead deps, raw adapter casts, fabricated capabilities version, 0-falsy bug. Ship v2 plan above.
