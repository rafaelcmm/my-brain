# Webapp Followup Plan — Tech Lead Review

Review date: 2026-04-23. Reviewer role: tech lead supervisor.
Scope: verify agent claim "webapp feature done" against `docs/technical/webapp-implementation-plan.md`.

Verdict: **partial.** Stack builds, 4 unit tests green, endpoints exist, routes render. But plan deliverables mostly shallow or stubbed. Many required libraries installed, unused. Hexagon leaks. Security gaps.

---

## 1. Evidence Collected

Ran:

- `pnpm --filter my-brain-web test --run` → 4 pass.
- `pnpm --filter my-brain-web run typecheck` → pass.
- `pnpm --filter my-brain-web run lint` → pass (no boundaries rule active).
- `pnpm --filter my-brain-web run build` → pass, 16 pages generated.

Inspected:

- All `src/web/src/app/**` route files.
- `src/web/src/lib/**` every file.
- `src/orchestrator/src/http/handlers/memory-{summary,list,graph}.ts`.
- `docker-compose.yml` + `src/gateway/Caddyfile`.
- Package.json deps vs grep of actual import sites.

---

## 2. Plan Coverage Matrix

| TODO                       | Claim | Actual           | Gap                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1 Scaffold                | done  | done             | none                                                                                                                                                                                                                                                                                                   |
| I2 Hexagon + domain        | done  | **shallow**      | single `types.ts` dumping ground (173 lines, 9 concepts) — violates objective-files rule; no `summary.ts`/`graph.ts`/`query.ts`/`metadata.ts` split; no Zod at env layer (plan mandated); no `eslint-plugin-boundaries` wired (dep installed, config absent)                                           |
| I3 Orchestrator adapter    | done  | **shallow**      | no Zod DTOs; no `mappers/`; `getCapabilities` fabricates `{version:"unknown"}`; zero adapter tests (plan required msw)                                                                                                                                                                                 |
| I4 Session + auth          | done  | **holes**        | encryption key uses raw UTF-8 slice (not KDF); `iron-session` + `jose` installed, unused; CSRF store exists, never invoked; rate-limit moved into Node (plan said Caddy)                                                                                                                               |
| I5 Login/logout + guard    | done  | **shallow**      | no CSRF enforcement on logout; `/login` does not redirect already-authed users; `autoComplete="current-password"` saves master token in browser password manager; zero route-handler unit tests                                                                                                        |
| I6 Dashboard               | done  | **3 of 8 cards** | only total/scope-count/type-count; missing top_tags/top_frameworks/top_languages/capabilities-panel/learning-stats/degraded-banner; no `error.tsx`/`loading.tsx`; no pagination                                                                                                                        |
| I7 Memories list           | done  | **shallow**      | no `/memories/[id]` page (dir absent); no bulk forget; no `ListMemoriesUseCase` in application layer — UI calls adapter directly; filter→URL mapping done as inline string concat in JSX                                                                                                               |
| I8 MD editor               | done  | **stub only**    | raw `<textarea>` — no CodeMirror 6; no Markdown preview; no `rehype-sanitize`; no Zod; no draft persistence; metadata panel has 2 fields (type, scope) out of 10+ required; lives at `/editor` not `/memories/new`; no `CreateMemoryUseCase`; no redirect to detail page                               |
| I9 Query runner            | done  | **shallow**      | no raw/parsed toggle; no latency display; no collapsible JSON tree; no `RunQueryUseCase`; no `mb_search` or raw REST passthrough                                                                                                                                                                       |
| I10 Graph view             | done  | **not built**    | renders a 20-row text list; no React Flow; no elkjs worker; no zoom/filter/export; no node click panel; no 2000-node perf test; no `GetMemoryGraphUseCase`; `@xyflow/react` + `elkjs` deps installed, unused                                                                                           |
| I11 Orchestrator endpoints | done  | done-ish         | `summary`, `list`, `graph` handlers exist and look clean; no integration tests; EXPLAIN ANALYZE evidence missing; graph lacks HNSW similarity edges                                                                                                                                                    |
| I12 Compose + gateway      | done  | **holes**        | healthcheck uses `/login` not `/api/health` (exists but ignored); `:3000` Caddy site missing `import bearer_auth` (intentional — webapp owns session — OK) but also missing `import rate_limit` for login path; `MYBRAIN_WEB_RATE_LIMIT_LOGIN` absent from compose env; smoke-test script not extended |
| T1 use-case unit tests     | done  | **1 of ~5**      | only `authenticate.usecase.test.ts` (2 cases); no tests for list/create/query/graph/summary use cases because **those use cases do not exist**                                                                                                                                                         |
| T2 adapter + session tests | done  | **2 of many**    | session store has 2 tests (encryption-at-rest + TTL sliding + CSRF NOT tested); zero HttpOrchestratorClient tests with msw; zero Route Handler tests invoked as functions                                                                                                                              |
| T3 orchestrator tests      | done  | **absent**       | no tests for `/v1/memory/{summary,list,graph}` handlers                                                                                                                                                                                                                                                |
| F1 security review         | done  | **not run**      | see §4 below                                                                                                                                                                                                                                                                                           |
| F2 performance review      | done  | **not run**      | no bundle analyser; no Lighthouse; no EXPLAIN ANALYZE attached to commits                                                                                                                                                                                                                              |
| F3 architecture review     | done  | **not run**      | hexagon leaks (§5); no `eslint-plugin-boundaries`                                                                                                                                                                                                                                                      |
| F4 documentation           | done  | **partial**      | `src/web/AGENTS.md` exists; no root README webapp section; `docs/technical/architecture.md` not updated with auth flow or new endpoints; no runbook update                                                                                                                                             |
| F5 lint/build/test         | done  | pass             | but lint gate is weak (see §5)                                                                                                                                                                                                                                                                         |

---

## 3. Dead Dependencies (installed, zero imports)

Grep `src/web/src/` for each → no matches:

- `zod` — plan mandated at every boundary.
- `@xyflow/react` — graph view.
- `elkjs` — graph layout worker.
- `iron-session` — session cookie.
- `jose` — JWT alt.
- `@tanstack/react-query` — live-polling widgets.
- `msw` — adapter tests.
- `@testing-library/react` + `jest-dom` — component tests.
- `pino` — logger port.

Bundle inflated, supply chain widened, no feature delivered. Either use or remove.

---

## 4. Security Findings

Ordered by severity.

**S1 — HIGH — session encryption key derivation unsafe**
`InMemorySessionStore.encryptBearer` uses `this.encryptionSecret.slice(0, 32)` as UTF-8 bytes for AES-256-GCM key. Non-ASCII secrets break. ASCII secrets lose bits of entropy vs a proper KDF. Fix: run secret through `crypto.scryptSync` or HKDF once at construction, cache derived 32-byte key.

**S2 — MEDIUM — CSRF store present, never enforced**
`verifyCSRFToken` / `getCSRFToken` exist on the port and store. No route handler calls them. Sole defence is `SameSite=Strict`. Any subdomain XSS or malformed-origin edge case bypasses. Fix: emit CSRF token from server layout, require header echo on every `/api/memory/*` + `/api/auth/logout` mutating route.

**S3 — MEDIUM — browser password manager will autofill master token**
`login/page.tsx` uses `autoComplete="current-password"`. Master token ends up in browser keychain. Switch to `autoComplete="off"` and `spellCheck={false}`.

**S4 — MEDIUM — `/api/memory/*` unrate-limited**
Rate limit applied to `/api/auth/login` only (in-process Map). An attacker with a valid session (e.g. stolen cookie) can hammer recall/digest. Fix: shared limiter keyed by session id + IP on all `/api/memory/*`.

**S5 — LOW — cookie missing `__Host-` prefix + `Path=/` only**
In production over HTTPS, `__Host-` prefix forbids domain scoping. Fix once TLS terminated.

**S6 — LOW — no `Cache-Control: no-store` on auth responses**
Some browsers may cache login response bodies with error payloads. Add header.

**S7 — LOW — dead deps broaden supply chain**
See §3.

**S8 — INFO — response uses raw `as unknown as T` casts**
`HttpOrchestratorClient` returns orchestrator payloads as untrusted JSON cast to typed shapes. Malformed response from a compromised orchestrator crashes downstream without clear error. Fix: Zod parse per method (plan required).

---

## 5. Architecture Findings

**A1 — Hexagon leaks.**
`app/(authed)/layout.tsx` imports `@/lib/infrastructure/session/store` directly. UI → infra. Should go through use case via composition root.

**A2 — Use-case layer mostly empty.**
Only `AuthenticateUseCase`. `list-memories`, `create-memory`, `get-memory-graph`, `get-brain-summary`, `run-query` missing. UI server components call adapter methods directly.

**A3 — `server-auth.ts` is composition root disguised as application code.**
It wires env + store + http client inside `lib/application/` but this is infra concerns. Move to `lib/composition/` (or `lib/bootstrap/`) and return `OrchestratorClient` port, not `HttpOrchestratorClient` class.

**A4 — `types.ts` dumping ground (173 lines, 9 concepts).**
Violates `~/.claude/rules/objective-files.md`. Split into `memory.ts`, `metadata.ts`, `graph.ts`, `summary.ts`, `query.ts`.

**A5 — `eslint-plugin-boundaries` not configured.**
Dep installed. `eslint.config.mjs` has only Next defaults. No layer rule. Add boundary rule so infra → app → domain direction is enforced.

**A6 — Env loader uses manual checks + `process.exit`.**
Plan mandated Zod. Replace with Zod schema; `process.exit` inside import graph is hostile to test runners.

---

## 6. Feature Gaps (user-visible)

**U1** Editor ships with `<textarea>`. No Markdown. No preview. No sanitisation.
**U2** Graph view is a bullet list. Not a graph.
**U3** Dashboard shows 3 counts. No tags/frameworks/languages/capabilities.
**U4** Memory detail page absent.
**U5** Bulk select + forget absent.
**U6** Query response is single `<pre>` blob. No raw/parsed toggle, no latency, no tool picker beyond recall/digest.
**U7** No degraded-mode banner when engine=false.
**U8** Already-authenticated user hitting `/login` sees the form again.

---

## 7. Priority-Ranked Followup TODO List

Same workflow contract as original plan: every TODO → specialist owner, scope, acceptance, verification, atomic commit. `workflow-orchestrator` coordinates. Caveman brief style below. Execute P0 before P1 before P2.

### P0 — Security + correctness (must ship before calling v1 done)

---

**F-SEC1 — Fix session key derivation**

- Owner: `security-reviewer` (owns) + `typescript-specialist` (implements)
- Scope: derive AES-256-GCM key via HKDF or scrypt from `MYBRAIN_WEB_SESSION_SECRET` once at store construction. Store the 32-byte derived key; never use raw secret bytes as key.
- Acceptance: unit test proves same session secret → same derived key → round-trip encrypt/decrypt; non-ASCII secret accepted.
- Verify: vitest.
- Commit: `fix(web): derive session key via hkdf`

**F-SEC2 — Enforce CSRF on mutating routes**

- Owner: `security-reviewer` + `typescript-specialist`
- Scope: issue CSRF token via server component into a `<meta>` tag of `(authed)/layout.tsx`; emit it server-side from `getSessionStore().getCSRFToken`. All client forms (`/editor`, `/query`, logout) must echo it in `X-Csrf-Token` header. Server routes reject mismatches.
- Acceptance: replay attack test (valid cookie, wrong token) returns 403.
- Verify: vitest on each /api route.
- Commit: `feat(web): enforce csrf on mutating routes`

**F-SEC3 — Rate-limit memory API + disable token autofill**

- Owner: `security-reviewer` + `devops-specialist`
- Scope: per-session + per-IP limiter on `/api/memory/*`. Login page input: `autoComplete="off"`, `spellCheck={false}`, `name` randomised. Add `Cache-Control: no-store` to auth responses.
- Acceptance: 61st request in a minute returns 429.
- Verify: vitest on limiter; manual DOM check.
- Commit: `fix(web): rate limit memory api and harden token input`

**F-SEC4 — Prune dead deps or prove use**

- Owner: `devops-specialist`
- Scope: remove `iron-session`, `jose`, `pino` if still unused after F-SEC1 and F-DOC1. Decide: if `zod`, `@xyflow/react`, `elkjs`, `@tanstack/react-query`, `msw`, `@testing-library/*` not used by the P1 batch below they must also be removed.
- Acceptance: `pnpm ls` tree lean; `pnpm audit` no new advisories.
- Commit: `chore(web): remove dead dependencies`

**F-ARCH1 — Restore hexagon boundaries**

- Owner: `design-architect`
- Scope: move composition (`server-auth.ts`, `session/store.ts` factory) into `lib/composition/`. UI pages + Route Handlers must only import from `application/` + domain types. Configure `eslint-plugin-boundaries` with rules:
  - `domain` → nothing
  - `application` → `domain`, `ports`
  - `infrastructure` → `domain`, `ports`
  - `composition` → all inner layers
  - `app/*` (UI) → `application`, `domain`, `composition`
- Acceptance: lint fails if `app/` imports from `infrastructure/`.
- Verify: deliberately add bad import in a draft commit, confirm ESLint errors, revert.
- Commit: `refactor(web): enforce hexagonal boundaries in eslint`

**F-ARCH2 — Split domain dumping ground**

- Owner: `design-architect`
- Scope: split `lib/domain/types.ts` into `memory.ts`, `metadata.ts`, `graph.ts`, `summary.ts`, `query.ts`. Update imports. No file > 100 lines.
- Acceptance: no file in `lib/domain/` exceeds 120 lines; no `types.ts`.
- Commit: `refactor(web): split domain types per objective-files rule`

**F-ARCH3 — Replace env loader with Zod schema**

- Owner: `typescript-specialist`
- Scope: Zod schema parses `process.env`; export parsed object; no `process.exit`; throw typed error caught by server bootstrap only.
- Commit: `refactor(web): zod env schema`

**F-ENDPOINT1 — Integration tests for `/v1/memory/{summary,list,graph}`**

- Owner: `database-specialist`
- Scope: hit each endpoint in the existing orchestrator integration harness with seeded data. Assert shape + counts + ordering. Attach `EXPLAIN ANALYZE` in commit body for summary and list.
- Acceptance: P95 < 500ms on 10k row fixture.
- Commit: `test(orchestrator): cover summary, list, graph endpoints`

### P1 — Feature completeness (plan deliverables that are stubs)

---

**F-FEAT1 — Real Markdown editor**

- Owner: `frontend-specialist`
- Scope: `/memories/new` (remove `/editor`, or redirect it) with CodeMirror 6 + `unified` + `remark-parse` + `remark-gfm` + `rehype-sanitize` split-pane preview. Metadata side panel: type, scope, repo, repo_name, language, frameworks (multi), tags (multi), path, symbol, source, author, agent, custom JSON blob. Zod validation. Draft persisted to `sessionStorage`. Success → redirect to `/memories/[id]`.
- Acceptance: preview renders sanitised HTML; submit writes all fields; reload restores draft.
- Verify: vitest on `CreateMemoryUseCase` happy + sad; component test on validation rendering.
- Commit: `feat(web): full markdown editor with metadata panel`

**F-FEAT2 — Dashboard: all 8 cards**

- Owner: `frontend-specialist`
- Scope: total / by-scope / by-type / top_tags / top_frameworks / top_languages / capabilities panel / learning stats / degraded-reason banner. Add `error.tsx` + `loading.tsx` under `(authed)/dashboard/`. Paginate if list > 10.
- Acceptance: renders all cards with seeded data; survives orchestrator 503 with friendly banner.
- Verify: vitest on `GetBrainSummaryUseCase`; RTL test per card.
- Commit: `feat(web): complete dashboard cards`

**F-FEAT3 — Real graph view**

- Owner: `frontend-specialist` + `design-architect`
- Scope: React Flow on `/graph`. elkjs layout in Web Worker. Node size ∝ `use_count + vote_bias`; colour by type. Side panel on click. Filter by scope/language. Zoom-to-fit. Export PNG. Extend `/v1/memory/graph` to include HNSW cosine edges above `minSimilarity` param (default 0.85).
- Acceptance: 2000 synthetic nodes at ≥ 30fps on mid-range laptop; commit body records fps + heap size.
- Verify: vitest on `GetMemoryGraphUseCase` (relation building, node size formula, mapper).
- Commit: `feat(web): knowledge graph with react-flow`

**F-FEAT4 — Query runner: raw/parsed toggle, latency, tool picker**

- Owner: `frontend-specialist`
- Scope: tool picker includes `mb_recall`, `mb_digest`, raw REST; dynamic form from schema in `lib/domain/query.ts`; response shows latency + status + payload sent + raw JSON + parsed view (collapsible JSON tree).
- Acceptance: every request shows latency; raw/parsed toggle works; 4xx/5xx show redacted error.
- Verify: vitest on `RunQueryUseCase` (recall/digest/error paths).
- Commit: `feat(web): query runner with latency and raw toggle`

**F-FEAT5 — Memory detail + bulk forget**

- Owner: `frontend-specialist`
- Scope: `/memories/[id]` page renders full memory + metadata + votes + back link; list page gets row checkboxes + "Forget selected" form action → `/api/memory/forget` per id.
- Acceptance: forget marks rows as gone on refresh; detail 404s correctly.
- Verify: vitest on `ListMemoriesUseCase` (serialisation, cursor, forget).
- Commit: `feat(web): memory detail page and bulk forget`

**F-FEAT6 — Login UX: redirect authed users + friendlier errors**

- Owner: `frontend-specialist`
- Scope: `/login` Server Component checks session → redirect `/dashboard`; surface `orchestrator-unavailable` vs `invalid-token` distinct error strings; add "forgot token?" link pointing at `docs/runbooks/local-operations.md`.
- Commit: `feat(web): login redirect and error copy`

### P2 — Testing + documentation gate (plan mandated)

---

**F-TEST1 — Adapter contract tests**

- Owner: `typescript-specialist`
- Scope: msw-based tests for `HttpOrchestratorClient` — every method: happy, 401 → `OrchestratorAuthError`, 500 → `OrchestratorUnavailableError`, malformed JSON → `OrchestratorValidationError`. Header injection assertions.
- Commit: `test(web): http adapter contract tests with msw`

**F-TEST2 — Route-handler unit tests**

- Owner: `typescript-specialist`
- Scope: import and call every `/api/**/route.ts` handler directly. Mock cookies + orchestrator port. Cases: unauth → 401; invalid JSON → 400; downstream 503 → 503; CSRF mismatch → 403.
- Commit: `test(web): api route handler unit tests`

**F-TEST3 — Use-case coverage to 90% branch**

- Owner: `typescript-specialist`
- Scope: all new use cases created in P1 get vitest coverage; report branch coverage in test script output.
- Commit: `test(web): use case coverage`

**F-TEST4 — Session store full contract**

- Owner: `typescript-specialist`
- Scope: cover encryption-at-rest (assert stored value differs from input), TTL sliding, CSRF verify happy + sad, destroy-clears-bearer, getBearer returns null after TTL.
- Commit: `test(web): session store full contract`

**F-DOC1 — Documentation Completion Step**

- Owner: `documentation-specialist`
- Scope: per `~/.claude/rules/commenting-standards.md`: all new exports (classes, modules, functions, methods, public properties, exported types) have contract docblocks. Inline comments only where intent non-obvious — no syntax narration. Root `README.md` gets a "Webapp" section (URL, login flow, troubleshooting). `docs/technical/architecture.md` gets auth flow diagram + two new orchestrator endpoints. `docs/runbooks/local-operations.md` gets "open webapp" + "rotate MYBRAIN_WEB_SESSION_SECRET" procedures. Confirm `src/web/AGENTS.md` matches sibling packages.
- Acceptance: `documentation-specialist` returns zero remaining findings; apply skills `commenting-standards`, `documentation-best-practices`, `typescript-documentation-best-practices`.
- Commit: `docs(web): contract docs, runbook, architecture`

**F-OPS1 — Wire webapp health into compose + smoke**

- Owner: `devops-specialist` + `docker-specialist`
- Scope: change `my-brain-web` healthcheck to `curl -fsS http://localhost:3000/api/health`; add `MYBRAIN_WEB_RATE_LIMIT_LOGIN` to compose env; extend `src/scripts/smoke-test.sh` with webapp login + dashboard reachability.
- Commit: `feat(stack): webapp healthcheck and smoke coverage`

**F-OPS2 — Caddy login rate limit**

- Owner: `devops-specialist`
- Scope: add `@login path /api/auth/login` matcher in `:3000` block; apply stricter zone (e.g. 10/min/IP). Security headers already imported — verify.
- Commit: `feat(gateway): stricter caddy rate limit for login`

### P3 — Polish (nice to have, not blocking)

---

**F-POL1** Bundle analyser in CI (target ≤ 200KB gzipped per non-graph route) → `frontend-specialist`.
**F-POL2** Lighthouse run on dashboard, record score in PR → `frontend-specialist`.
**F-POL3** Log redaction middleware (pino) so bearers never reach stdout → `security-reviewer`.
**F-POL4** OIDC plug-point: keep session store interface stable, add `PasswordlessAuthPort` to unblock future multi-user auth → `design-architect`.

---

## 8. Workflow Entry Point for Followup

Executor opens the work by invoking, in order:

1. **`workflow-orchestrator`** — owns the TODO tracker; anchors to this document.
2. **`security-reviewer`** — reviews P0 security items before any code edit (F-SEC1–F-SEC4).
3. **`design-architect`** — ratifies the hexagon restructure in F-ARCH1–F-ARCH3.

Then P0 TODOs begin, one at a time, atomic commits per TODO.

---

## 9. Stop Condition for Followup

- All P0 TODOs done, committed.
- All P1 TODOs done, committed.
- All P2 TODOs done, committed.
- Plan coverage matrix in §2 has zero `shallow` / `not built` / `absent` rows.
- Dead-deps list in §3 empty.
- Security findings S1–S4 remediated and a reviewer pass signed off.
- `pnpm --filter my-brain-web run lint && typecheck && test --run && build` green.
- `docker compose up -d --build` brings webapp up and a user can: log in → see all 8 dashboard cards → view a real node-edge graph → open detail → bulk forget → write a memory through CodeMirror with metadata → run a query with latency + raw/parsed toggle → log out.

---

## 10. Anti-Patterns Seen in Current Work (do not repeat)

- Installing heavy deps "for later" and landing a PR that does not use them.
- Landing a TODO as "done" when the plan's verification step was skipped (e.g. "no adapter msw tests" for I3).
- UI components importing `lib/infrastructure/*` — bypasses ports.
- Dumping 9 domain concepts into one `types.ts`.
- Single-`<pre>` query view labelled "query runner".
- Bullet-list graph labelled "graph view".
- Dashboard claiming "summary" with 3 of 8 required cards.
- Dead `iron-session` / `jose` / `zod` / `@xyflow/react` / `elkjs` imports.
- Rate limit in application process when gateway was specified.
- `process.exit` inside library import graph.

---

## 11. Executor Checklist

- [ ] Read this document top to bottom.
- [ ] Invoke `workflow-orchestrator`, `security-reviewer`, `design-architect`.
- [ ] F-SEC1 committed.
- [ ] F-SEC2 committed.
- [ ] F-SEC3 committed.
- [ ] F-SEC4 committed.
- [ ] F-ARCH1 committed.
- [ ] F-ARCH2 committed.
- [ ] F-ARCH3 committed.
- [ ] F-ENDPOINT1 committed.
- [ ] F-FEAT1 committed.
- [ ] F-FEAT2 committed.
- [ ] F-FEAT3 committed.
- [ ] F-FEAT4 committed.
- [ ] F-FEAT5 committed.
- [ ] F-FEAT6 committed.
- [ ] F-TEST1 committed.
- [ ] F-TEST2 committed.
- [ ] F-TEST3 committed.
- [ ] F-TEST4 committed.
- [ ] F-DOC1 committed.
- [ ] F-OPS1 committed.
- [ ] F-OPS2 committed.
- [ ] P3 items triaged: either committed or moved to a tracking issue.
- [ ] Final lint/typecheck/test/build pass green; dead-dep list empty; reviewer agents sign off.
