# TypeScript Migration & Orchestrator Revamp Plan

> Single-source plan. Branch: `main` (early-stage repo, no feature branch).
> Caveman process notes throughout. Code and commits written normal.

---

## 1. Current State Audit

- **Orchestrator**: `src/orchestrator/src/index.mjs` — **2666 lines**, pure ESM JS, single file. ~60 top-level functions. Uses `createRequire` for `ruvector`, `@ruvector/ruvllm`, `@ruvector/server`. No tests. No tsconfig. Scripts: `start`, `dev`, `lint` (= `node --check`), `test` (= `node --test`, no test files).
- **mcp-bridge**: already modular TS — `bootstrap/`, `config/`, `domain/`, `infrastructure/`, `mcp/{handlers,result,server}.ts`. Strict tsconfig (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`). Has its own `tsconfig.json`, `package.json`, tests in `.mjs`.
- **Root**: `package.json` has no workspaces, only `prettier` devDep, proxies to orchestrator for `lint`/`test`. Ships **both** `package-lock.json` and `pnpm-lock.yaml` → broken. Both packages declare `packageManager: pnpm@9.15.4`.
- **Other src folders**: `gateway/` (Caddyfile + Dockerfile, no JS), `db/init/` (SQL), `scripts/` (bash). Out of scope.
- **No root tsconfig**. No shared TS baseline.

Fence note (Chesterton): monolith is the only working code path. Every extraction must preserve behavior — env parsing quirks, rate-limit timing, embedding cache keying, request handler branching.

---

## 2. Target State

### 2.1 Root

```
my-brain/
├── tsconfig.base.json          # strict baseline — extended by every package
├── tsconfig.json               # solution file with project references
├── package.json                # pnpm workspace root + shared dev deps
├── pnpm-workspace.yaml         # workspace declaration
├── eslint.config.js            # flat config, @typescript-eslint
└── src/
    ├── orchestrator/           # fully TS, modular (see §2.2)
    ├── mcp-bridge/             # existing TS, align tsconfig to extends base
    ├── gateway/                # unchanged
    ├── db/                     # unchanged
    └── scripts/                # unchanged
```

**Delete**: `package-lock.json` (pnpm wins, matches `packageManager` field in both packages).

### 2.2 Orchestrator Target Layout (hexagonal)

```
src/orchestrator/
├── package.json                # type=module, scripts: build/dev/start/test/typecheck
├── tsconfig.json               # extends ../../tsconfig.base.json, rootDir=src, outDir=dist
├── src/
│   ├── index.ts                # ≤80 lines: bootstrap only
│   ├── bootstrap/
│   │   └── main.ts             # wire runtime → http server
│   ├── config/
│   │   └── load-config.ts      # parse env → typed Config
│   ├── domain/
│   │   ├── types.ts            # Memory, Envelope, Config, Capabilities, etc.
│   │   ├── memory-validation.ts # validateMemoryEnvelope, sanitizeText, sanitizeTags
│   │   ├── fingerprint.ts      # contentFingerprint, asVector, similarity
│   │   ├── scoring.ts          # voteBias, lexicalBoost
│   │   └── project-context.ts  # detectLanguage, detectFrameworks, parseRemoteRepo
│   ├── application/
│   │   ├── recall.ts           # recall use case
│   │   ├── remember.ts         # remember use case (dedup + persist)
│   │   ├── digest.ts           # digest use case
│   │   └── backfill.ts         # backfillMemoryMetadata
│   ├── infrastructure/
│   │   ├── postgres.ts         # pool, ensureAdrSchemas, initializeDatabase
│   │   ├── postgres-memory.ts  # queryRecallCandidates, findDuplicateMemory, persist, voteBias
│   │   ├── embedding.ts        # initializeEmbeddingProvider, embedText, cache
│   │   ├── intelligence.ts     # ruvector engine init
│   │   ├── llm-runtime.ts      # ruvllm init
│   │   └── git.ts              # runGitCommand
│   ├── policies/
│   │   ├── rate-limit.ts       # allowRequest, rateBuckets
│   │   └── auth.ts             # validateAuthToken, hasValidInternalKey, MIN_TOKEN_LENGTH
│   ├── observability/
│   │   ├── metrics.ts          # counters, histograms, renderMetrics
│   │   └── log.ts              # logInternalError, sanitizeStatusError, pushDegradedReason
│   ├── http/
│   │   ├── server.ts           # http.createServer + routing dispatch
│   │   ├── body.ts             # parseJsonBody, sendJson, MAX_REQUEST_BODY_BYTES
│   │   └── handlers/
│   │       ├── health.ts
│   │       ├── capabilities.ts
│   │       ├── metrics.ts
│   │       ├── recall.ts
│   │       ├── remember.ts
│   │       ├── digest.ts
│   │       └── backfill.ts
│   └── types/
│       └── ambient.d.ts        # declare module "ruvector"; "@ruvector/ruvllm"; "@ruvector/server"
└── test/
    ├── unit/                   # domain pure-function tests (no I/O)
    ├── integration/            # real Postgres via docker-compose (no mocks — project rule)
    └── e2e/                    # smoke: boot + HTTP roundtrip
```

Per-file ceiling: **≤300 lines logic**. Every public export carries a docblock per `commenting-standards`.

### 2.3 Shared `tsconfig.base.json`

Mirrors the bridge's strict baseline:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"],
    "allowJs": false,
    "noEmit": false,
  },
}
```

Per-package `tsconfig.json` only sets `extends`, `rootDir`, `outDir`, `include`, and (for solution file) `references`.

Root solution `tsconfig.json`:

```jsonc
{
  "files": [],
  "references": [
    { "path": "./src/orchestrator" },
    { "path": "./src/mcp-bridge" },
  ],
}
```

---

## 3. Execution TODOs (workflow rule compliant)

Order is sequential. Each TODO = atomic conventional commit. No batching.

### Phase A — Repo Foundation

| ID     | Scope                                                                                                                                                                                                                                            | Owner                   | Acceptance                                                         | Verification                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| **A1** | `pnpm-workspace.yaml`; root `package.json` adds `workspaces`, `typescript`, `tsx`, `@types/node`, `eslint`, `@typescript-eslint/*`, `prettier`. Delete `package-lock.json`. Rescript root: `build`, `typecheck`, `lint`, `test`, `format:check`. | `devops-specialist`     | One package manager (pnpm). Root scripts fan out to both packages. | `pnpm install` clean. `pnpm -r run typecheck` passes bridge. |
| **A2** | `tsconfig.base.json` at root. Root solution `tsconfig.json` with references. Align `src/mcp-bridge/tsconfig.json` to extend base (drop duplicated options).                                                                                      | `typescript-specialist` | Bridge still builds identical output. `tsc -b` works from root.    | `pnpm -r run build` green.                                   |
| **A3** | ESLint flat config (`eslint.config.js`) + `.editorconfig` + prettier config. Wire `lint` script to ESLint + prettier check.                                                                                                                      | `typescript-specialist` | Bridge passes lint clean.                                          | `pnpm run lint` green.                                       |

Commit: `chore(repo): pnpm workspace + root tsconfig base`, `build(ts): root solution tsconfig references`, `chore(lint): flat eslint config`.

### Phase B — Orchestrator Revamp (incremental, behavior-preserving)

Each B-step extracts a slice from `index.mjs` into typed modules, **consumes it back from a shrinking bootstrap shim**, and commits atomically. The monolith dies only when every consumer is rewired.

| ID     | Slice                                                                                                                                                                                                                                                                                                                                   | Target files            | Owner                                                      | Acceptance |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | ---------- |
| **B0** | Add `src/orchestrator/tsconfig.json` extending base. Add `src/orchestrator/src/types/ambient.d.ts` for `ruvector`, `@ruvector/ruvllm`, `@ruvector/server`. Rename `index.mjs` → `legacy-index.mjs` (temporary import target). Add new `index.ts` that re-exports from legacy. `build`/`dev`/`start`/`typecheck`/`test` scripts updated. | `typescript-specialist` | Package still boots via `node dist/index.js`.              |
| **B1** | Extract `domain/types.ts` (Config, Envelope, Memory, Capabilities, RateBucket, etc). No logic moved yet — pure types.                                                                                                                                                                                                                   | `typescript-specialist` | Types reused in B2+.                                       |
| **B2** | Extract `domain/{fingerprint,scoring,memory-validation,project-context}.ts` (pure functions, no I/O). Legacy shim imports them. Delete their copies in `legacy-index.mjs`.                                                                                                                                                              | `typescript-specialist` | Pure unit tests pass (added in T1).                        |
| **B3** | Extract `config/load-config.ts`, `observability/{metrics,log}.ts`, `policies/{rate-limit,auth}.ts`. Wire legacy shim to new modules.                                                                                                                                                                                                    | `typescript-specialist` | No behavior drift.                                         |
| **B4** | Extract `infrastructure/{postgres,postgres-memory}.ts`. Pool creation, schema ensure, recall/dedup/persist queries.                                                                                                                                                                                                                     | `database-specialist`   | Real-Postgres integration test (T2) passes.                |
| **B5** | Extract `infrastructure/{embedding,intelligence,llm-runtime,git}.ts`. Ambient types let TS consume `ruvector` without `createRequire`.                                                                                                                                                                                                  | `typescript-specialist` | Degraded-mode paths preserved.                             |
| **B6** | Extract `application/{recall,remember,digest,backfill}.ts` — use cases composed from infra + domain.                                                                                                                                                                                                                                    | `design-architect`      | Each use case ≤300 lines, single responsibility.           |
| **B7** | Extract `http/{body,server}.ts` + `http/handlers/*.ts`. Route table lives in `server.ts`.                                                                                                                                                                                                                                               | `typescript-specialist` | All existing endpoints reachable with identical responses. |
| **B8** | `bootstrap/main.ts` wires Config → infra → use cases → http. Replace `index.ts` with ≤80-line bootstrap that calls `main()`. **Delete `legacy-index.mjs`.**                                                                                                                                                                             | `design-architect`      | No references to legacy file. `pnpm run build` green.      |

Commits: `refactor(orchestrator): <slice>` one per TODO.

### Phase C — Bridge Alignment

| ID     | Scope                                                                                                                                | Owner                   | Acceptance                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------- |
| **C1** | Bridge `tsconfig.json` extends `../../tsconfig.base.json`; drop duplicated compiler options. Root references include bridge.         | `typescript-specialist` | Bridge output byte-identical or verified equivalent. |
| **C2** | Convert bridge `.mjs` tests → `.test.ts` compiled alongside source, or kept as `.mjs` driving compiled `dist/` — pick one, document. | `typescript-specialist` | `pnpm --filter my-brain-mcp-bridge test` green.      |

### Phase D — Testing Matrix

| ID     | Scope                                                                                                                                        | Owner                   | Acceptance                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------- |
| **T1** | Unit tests — `domain/*` pure functions (fingerprint, scoring, validation, project-context). `node --test` via tsx.                           | `typescript-specialist` | ≥80% line coverage on `domain/`.       |
| **T2** | Integration tests — real Postgres (docker-compose override for test DB). Project rule: **no mocks**. Cover recall, dedup, persist, backfill. | `database-specialist`   | Suite green against live DB.           |
| **T3** | HTTP handler tests — spin server, hit endpoints, assert status + body.                                                                       | `typescript-specialist` | All endpoints covered.                 |
| **T4** | E2E smoke — `pnpm run docker:up:cpu` + hit `/health`, `/capabilities`, `/recall`.                                                            | `devops-specialist`     | Existing `smoke-test.sh` still passes. |
| **T5** | Bridge contract test — bridge talks to new orchestrator, asserts capability catalog unchanged.                                               | `typescript-specialist` | Contract unchanged vs pre-migration.   |

### Phase E — Final Checkup Gate

| ID     | Scope                                                                                                                           | Owner                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **F1** | Security review — OWASP pass, token handling, input sanitization, error surface.                                                | `security-reviewer`                         |
| **F2** | Performance review — recall latency, embedding cache hit rate, rate-limit accuracy.                                             | `database-specialist` + `devops-specialist` |
| **F3** | Documentation review — every public symbol has docblock per `commenting-standards` + `typescript-documentation-best-practices`. | `documentation-specialist`                  |
| **F4** | CI / Docker review — Dockerfile updates to build TS, smoke CI still green.                                                      | `docker-specialist` + `devops-specialist`   |
| **F5** | Simplification pass — kill any accidental abstraction introduced during extraction; enforce `objective-files` rule.             | `design-architect`                          |
| **F6** | Lint / format / build gate — `pnpm run lint`, `pnpm exec prettier --check .`, `pnpm -r run build`, full test suite.             | `typescript-specialist`                     |
| **F7** | Apply all reviewer-requested fixes; re-run F6.                                                                                  | per reviewer                                |
| **F8** | Documentation Completion Step commit.                                                                                           | `documentation-specialist`                  |
| **F9** | Close migration: update `README.md` section on structure; delete stale docs.                                                    | `documentation-specialist`                  |

Final commit: `chore(repo): complete typescript migration`.

---

## 4. Agent / Skill Map

| Work                             | Specialist                                | Skills                                                                    |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Plan coordination                | `workflow-orchestrator`                   | —                                                                         |
| TS types / generics / tsconfig   | `typescript-specialist`                   | `typescript-documentation-best-practices`                                 |
| Hexagonal layout, DDD boundaries | `design-architect`                        | `objective-files`, `chestertons-fence`                                    |
| Postgres schema, query perf      | `database-specialist`                     | —                                                                         |
| Dockerfile, CI, workspace wiring | `devops-specialist` + `docker-specialist` | `docker-core-architecture`                                                |
| Security surface                 | `security-reviewer`                       | OWASP                                                                     |
| Every code file                  | —                                         | `commenting-standards`                                                    |
| Markdown / README                | `documentation-specialist`                | `documentation-best-practices`, `javascript-documentation-best-practices` |
| Prompt any downstream agent from | `prompt-engineer`                         | `prompt-master`                                                           |

Non-trivial work dispatched via `workflow-orchestrator` per code-change-workflow rule.

---

## 5. Commit Strategy (on `main`)

- One conventional commit per TODO. No batching.
- Prefixes: `chore(repo)`, `build(ts)`, `refactor(orchestrator)`, `test(...)`, `docs(...)`, `fix(...)`.
- Push after each commit — early-stage repo, no PR gate, but every push must leave `main` in a working state (build + smoke green).

---

## 6. Risks & Mitigations

| Risk                                                                                           | Mitigation                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Behavior drift during extraction                                                               | Legacy shim pattern (B0–B8): every slice stays wired through the monolith until last extraction. Integration tests (T2) run after each infra step.                                                          |
| `ruvector` / `@ruvector/*` untyped                                                             | Ambient `.d.ts` in `src/orchestrator/src/types/ambient.d.ts`; keep `createRequire` semantics until TS `import` is proven equivalent. Fence note: these libs initialize engines — do not replace init order. |
| Mixed lockfiles persist                                                                        | A1 deletes `package-lock.json`, commits `pnpm-lock.yaml` as source of truth.                                                                                                                                |
| Strict TS rejects existing patterns (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | Fix at extraction time; no `@ts-nocheck` / `any` shortcuts. Bridge already proved the baseline works.                                                                                                       |
| Docker build breaks on `.ts` → `.js`                                                           | F4 updates Dockerfile multistage: `pnpm build` before runtime copy. Smoke CI catches regressions.                                                                                                           |
| Test suite needs live DB                                                                       | T2 uses compose-based test DB, matches the "no mocks for DB" project rule.                                                                                                                                  |

---

## 7. Stop Condition

All true:

- [ ] Phase A–E TODOs done.
- [ ] `legacy-index.mjs` deleted; orchestrator boots from `dist/index.js`.
- [ ] `pnpm -r run build && pnpm -r run test && pnpm run lint && pnpm exec prettier --check .` green.
- [ ] Smoke test green (`src/scripts/smoke-test.sh`).
- [ ] Every changed file passes `commenting-standards` review.
- [ ] Atomic commit per TODO on `main`.

---

## 8. Confirmed Decisions

1. **Package manager**: **pnpm** is the sole PM. `package-lock.json` deleted in A1.
2. **HTTP contract**: frozen. Bridge contract tests (T5) assert no drift; any endpoint change is out of scope for this migration.
3. **Scope**: TypeScript migration covers `src/orchestrator/` and `src/mcp-bridge/` only. `src/gateway/`, `src/db/`, `src/scripts/` stay as-is.
4. **Test DB**: T2 adds `docker-compose.test.yml` with an ephemeral Postgres instance for integration tests. Teardown in CI + local scripts.

Execution starts at Phase A / TODO A1.
