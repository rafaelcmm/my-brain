# my-brain Webapp — Implementation Plan

This plan describes how to add a Next.js webapp to the `my-brain` stack so a human operator can visualise brain data, browse the knowledge graph, add memories through a Markdown editor, and run MCP tool queries from a browser.

The plan is written for a **lower-capacity LLM executor**. Each step is self-contained, names the specialist agent that should own it, states acceptance criteria, and ends with an atomic commit.

The workflow strictly follows `~/.claude/rules/code-change-workflow.md`:

1. Plan → 2. Orchestrator delegation → 3. Specialist evaluation → 4. Implementation TODOs → 5. Testing TODOs → 6. Atomic commits after each TODO → 7. Final Checkup TODOs → 8. Reviewer subagents → 9. Apply fixes → 10. Documentation Completion Step → 11. Final commit.

---

## 0. Context the executor must read before starting

Read these files before writing any code. Do not guess project conventions.

| File | Why |
| ---- | --- |
| `AGENTS.md` | Cross-tool operating contract |
| `docker-compose.yml` | Service topology, networks, secrets, volumes |
| `src/gateway/Caddyfile` | Bearer auth, rate limits, reverse-proxy pattern |
| `src/orchestrator/src/http/router.ts` | REST endpoints the webapp will call |
| `src/orchestrator/src/http/handlers/*.ts` | Payload shapes for each endpoint |
| `src/db/init/02-memory-metadata.sql` | Metadata schema — drives filters, summary cards, graph nodes |
| `src/orchestrator/src/domain/types.ts` | Shared domain types to mirror in the web package |
| `docs/technical/architecture.md` | Existing architecture constraints |

---

## 1. High-Level Design Decisions (fixed — do not re-litigate)

1. **Placement.** The webapp is a new Docker Compose service named `my-brain-web`, on the same network as the orchestrator. "Same docker container as the entire project" is interpreted as **same Compose project / same network**, not a single literal container. Running Next.js in the orchestrator container is rejected — it violates single-responsibility and complicates the Node runtime boundary.
2. **Next.js mode.** App Router, Server Components by default, Client Components only where interaction requires it. Output mode: `standalone` for Docker image size.
3. **Routing through Caddy.** The browser never talks to the orchestrator directly. Caddy gets a new site block (`:8000` or a subpath) that proxies to `my-brain-web:3000` **without** bearer auth (the webapp runs its own session cookie gate) and rate-limits login attempts.
4. **Auth strategy.**
   - The existing `MYBRAIN_AUTH_TOKEN` secret stays the **master credential**.
   - The webapp shows a login form. On submit, a Next.js Route Handler verifies the pasted token by calling `GET /v1/capabilities` through Caddy with `Authorization: Bearer <token>`. A 200 proves the token is valid.
   - On success, the webapp issues a **signed, httpOnly, SameSite=Strict session cookie** (JWT or iron-session style) with short TTL (e.g. 2h sliding) and stores the bearer token **server-side only**, encrypted with `MYBRAIN_WEB_SESSION_SECRET`, keyed by the session id.
   - All subsequent browser → webapp requests ride the session cookie. The webapp's server-side layer injects the bearer token and `X-Mybrain-Internal-Key` when calling the orchestrator. The bearer token is **never** exposed to the client bundle.
   - CSRF: enforce SameSite=Strict + a per-session CSRF token on mutating Server Actions.
5. **Architecture.** Hexagonal. The `web` package has its own `domain/`, `application/`, `ports/`, `infrastructure/`, and `ui/` layers. UI components never call HTTP directly — they call Server Actions or Server Component loaders, which call use cases, which call ports, which are implemented by HTTP adapters to the orchestrator.
6. **File size rule.** Max 300 lines of logic per file (per `~/.claude/rules/objective-files.md`). No `utils.ts`, `helpers.ts`, or barrel `types/index.ts` catch-alls.
7. **Graph rendering.** Use **React Flow** (`@xyflow/react`) for the graph view. Rationale: supports up to ~5k nodes with clustering, first-class TypeScript, SSR-friendly, MIT licence. Layout via `elkjs` worker.
8. **Markdown editor.** Use **@uiw/react-md-editor** or **CodeMirror 6 + unified/remark** for the editor. Pick **CodeMirror 6 + remark** for better modularity (rejects vendor lock-in, aligns with file-size rule).
9. **State/data.** Server Components + Server Actions + **TanStack Query** only for live-polling widgets (summary auto-refresh, query-tool streaming).
10. **Styling.** Tailwind v4 (latest) + shadcn/ui primitives. No CSS-in-JS runtime.
11. **Schema validation.** Zod at every boundary (form → server action, adapter → orchestrator response).

---

## 2. Target directory layout

```
src/web/
├── Dockerfile
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.js
├── .env.example
├── public/
└── app/                          # Next.js App Router (UI adapter)
    ├── layout.tsx
    ├── page.tsx                  # redirect → /dashboard or /login
    ├── login/
    │   ├── page.tsx
    │   ├── login.form.tsx        # client component
    │   └── actions.ts            # loginAction server action
    ├── (authed)/
    │   ├── layout.tsx            # session guard + shell
    │   ├── dashboard/
    │   │   ├── page.tsx
    │   │   ├── SummaryCards.tsx
    │   │   ├── RecentMemories.tsx
    │   │   └── CapabilitiesPanel.tsx
    │   ├── graph/
    │   │   ├── page.tsx
    │   │   ├── GraphCanvas.tsx   # client, React Flow
    │   │   ├── GraphControls.tsx
    │   │   └── layout.worker.ts  # elkjs layout worker
    │   ├── memories/
    │   │   ├── page.tsx          # list + filters
    │   │   ├── new/
    │   │   │   ├── page.tsx
    │   │   │   ├── MemoryEditor.tsx
    │   │   │   ├── MetadataFields.tsx
    │   │   │   └── actions.ts
    │   │   └── [id]/page.tsx
    │   └── query/
    │       ├── page.tsx
    │       ├── QueryForm.tsx
    │       ├── ResponseView.tsx
    │       └── actions.ts
    └── api/
        ├── auth/
        │   ├── login/route.ts
        │   └── logout/route.ts
        └── health/route.ts

src/web/lib/                      # hexagon — everything outside `app/`
├── domain/
│   ├── memory.ts                 # Memory, MemoryId, Scope
│   ├── metadata.ts               # MetadataFields value object
│   ├── graph.ts                  # GraphNode, GraphEdge, GraphSnapshot
│   ├── summary.ts                # BrainSummary value object
│   └── query.ts                  # QueryRequest, QueryResponse
├── application/
│   ├── get-brain-summary.usecase.ts
│   ├── list-memories.usecase.ts
│   ├── get-memory-graph.usecase.ts
│   ├── create-memory.usecase.ts
│   ├── run-query.usecase.ts
│   └── authenticate.usecase.ts
├── ports/
│   ├── orchestrator-client.port.ts
│   ├── session-store.port.ts
│   └── logger.port.ts
├── infrastructure/
│   ├── orchestrator/
│   │   ├── http-orchestrator-client.ts
│   │   ├── dto/
│   │   │   ├── capabilities.dto.ts
│   │   │   ├── memory.dto.ts
│   │   │   └── recall.dto.ts
│   │   └── mappers/
│   │       ├── memory.mapper.ts
│   │       └── summary.mapper.ts
│   ├── session/
│   │   ├── iron-session.ts       # or jose-based JWT
│   │   └── csrf.ts
│   └── logger/
│       └── pino-logger.ts
└── config/
    └── env.ts                    # Zod-validated server env
```

All files must stay under 300 logic lines. Split when they approach the limit.

---

## 3. Environment contract

Add to `.env.example` and `docker-compose.yml`:

| Var | Purpose | Where consumed |
| --- | ------- | -------------- |
| `MYBRAIN_WEB_PORT` | Host port for the webapp via Caddy | compose + Caddy |
| `MYBRAIN_WEB_SESSION_SECRET` | 32+ byte random, encrypts session cookie | web container |
| `MYBRAIN_WEB_ORCHESTRATOR_URL` | `http://my-brain-orchestrator:8080` | web container |
| `MYBRAIN_INTERNAL_API_KEY` | Reused from existing stack | web container |
| `MYBRAIN_WEB_RATE_LIMIT_LOGIN` | Login attempts/min | Caddy |
| `MYBRAIN_WEB_PUBLIC_BASE_URL` | Base URL for absolute links | web container |
| `MYBRAIN_WEB_LOG_LEVEL` | pino level | web container |

---

## 4. Workflow entry point

The executor starts the work by invoking, in order:

1. **`workflow-orchestrator`** — produces and maintains the canonical TODO list for this plan. Anchor it to this document.
2. **`design-architect`** — reviews the design decisions in section 1 and either ratifies them or proposes at most one focused deviation with reasoning.
3. **`security-reviewer`** — reviews the auth model in section 1.4 before any code is written. Must sign off on: token-to-session exchange, cookie flags, CSRF, rate limiting, bearer token exposure risk.

Only after those three return do implementation TODOs begin.

---

## 5. TODO List

Every TODO has: `id`, `owner` (specialist agent), `scope`, `acceptance criteria`, `verification step`, `status`. Execute **one at a time**. Create an **atomic commit** after each TODO using conventional commits.

### 5.1 Implementation TODOs

---

**TODO I1 — Scaffold Next.js package**
- **Owner:** `typescript-specialist`
- **Scope:** Create `src/web/` with Next.js latest (App Router, TypeScript strict, Turbopack dev, `output: "standalone"`). Add to `pnpm-workspace.yaml`. Add `tsconfig.json` extending `tsconfig.base.json`. Configure ESLint + Prettier to match repo.
- **Acceptance:** `pnpm --filter my-brain-web dev` boots on port 3000 and serves a placeholder page. `pnpm run lint` passes. `pnpm run typecheck` passes.
- **Verification:** `pnpm --filter my-brain-web build` succeeds; `.next/standalone` exists.
- **Commit:** `feat(web): scaffold next.js app router package`

---

**TODO I2 — Hexagonal skeleton + domain types**
- **Owner:** `design-architect`
- **Scope:** Create `lib/domain/`, `lib/application/`, `lib/ports/`, `lib/infrastructure/`, `lib/config/` folders. Define domain types: `Memory`, `MemoryId`, `Scope`, `MetadataFields`, `GraphNode`, `GraphEdge`, `GraphSnapshot`, `BrainSummary`, `QueryRequest`, `QueryResponse`. Define port interfaces `OrchestratorClient`, `SessionStore`, `Logger`. Add `config/env.ts` with Zod validation of all env vars from section 3. **No implementations yet, no dependencies on `next`.**
- **Acceptance:** Types mirror the orchestrator's response shapes from `src/orchestrator/src/domain/types.ts`. No file > 300 lines. No cross-layer import violations (use `eslint-plugin-boundaries`).
- **Verification:** `pnpm run typecheck` passes. Lint boundary rule enabled and green.
- **Commit:** `feat(web): add hexagonal skeleton and domain types`

---

**TODO I3 — Orchestrator HTTP adapter**
- **Owner:** `typescript-specialist`
- **Scope:** Implement `HttpOrchestratorClient` in `lib/infrastructure/orchestrator/`. One method per port action. Use `fetch` with a small `requestJson` helper **inside the adapter only** (not shared). Inject bearer + `X-Mybrain-Internal-Key` headers. Parse responses with Zod DTOs in `dto/`, then map to domain types in `mappers/`. Split files per endpoint if a single file exceeds 300 lines.
- **Acceptance:** Adapter implements every port method. All network IO flows through this file. Zod validation on every response. Errors wrapped in typed domain errors (`OrchestratorUnavailableError`, `OrchestratorAuthError`, `OrchestratorValidationError`).
- **Verification:** Vitest unit tests with `msw` mocking orchestrator responses for each method.
- **Commit:** `feat(web): http adapter for orchestrator rest api`

---

**TODO I4 — Session store + auth use case**
- **Owner:** `security-reviewer` (owns), `typescript-specialist` (implements)
- **Scope:** Implement `iron-session` (or `jose` JWT) session cookie: `httpOnly`, `secure` in prod, `SameSite=Strict`, 2h sliding TTL, signed with `MYBRAIN_WEB_SESSION_SECRET`. Implement `SessionStore` port with in-memory encrypted bearer storage keyed by session id (so the bearer is never in the cookie payload). Implement `authenticate.usecase.ts`: takes the pasted token, calls `orchestratorClient.getCapabilities()`, on 200 creates a session. Add CSRF helper for Server Actions.
- **Acceptance:** Cookie flags verified in tests. Bearer token never serialised into the client-accessible payload. Replaying a stolen cookie without the server-side store entry fails.
- **Verification:** Unit tests for cookie flags, token verification happy + sad paths, CSRF mismatch rejection.
- **Commit:** `feat(web): session auth with bearer-to-cookie exchange`

---

**TODO I5 — Login + logout routes and guard**
- **Owner:** `frontend-specialist`
- **Scope:** `/login` page with minimal form (paste token, submit). `POST /api/auth/login` Route Handler invokes `authenticate.usecase`. `POST /api/auth/logout` destroys the session. `(authed)/layout.tsx` reads the session in a Server Component and redirects to `/login` if absent. Add friendly errors for invalid token / orchestrator down. Rate-limit login at the Caddy layer.
- **Acceptance:** Unauthenticated users hitting `/dashboard` are redirected. Logged-in users cannot re-enter `/login`. Logout clears the cookie and the server-side bearer.
- **Verification:** Vitest unit tests on the login/logout Route Handlers and the guard layout: happy token, wrong token, orchestrator-down, missing-session redirect, CSRF mismatch. Mock the orchestrator client at the port level.
- **Commit:** `feat(web): login, logout and route guard`

---

**TODO I6 — Dashboard with brain summary**
- **Owner:** `frontend-specialist`
- **Scope:** `/dashboard` Server Component calls `GetBrainSummaryUseCase`. Cards: total memories, memories by scope, memories by type, top tags, top frameworks, top languages, capabilities panel (`/v1/capabilities`), learning stats (`/v1/learning/stats`), degraded-reasons banner. A **new orchestrator endpoint** `GET /v1/memory/summary` may be needed — see TODO I11.
- **Acceptance:** Page renders all cards within one request; loading/error states via `error.tsx` + `loading.tsx`. No client JS bundle for static cards. Cards paginate if list > 10.
- **Verification:** Vitest unit tests for `GetBrainSummaryUseCase` and for the card components (React Testing Library, render + assert on mocked props). Manual visual check in the browser documented in the commit body.
- **Commit:** `feat(web): dashboard summary`

---

**TODO I7 — Memories list + filters**
- **Owner:** `frontend-specialist`
- **Scope:** `/memories` Server Component with URL-based filters (scope, type, repo, language, tag, search-text). Pagination via cursor. Uses `ListMemoriesUseCase` → `orchestratorClient.listMemories`. Row click → `/memories/[id]`.
- **Acceptance:** Filter changes reflected in URL, preserved on refresh. Bulk select + forget action available (calls `/v1/memory/forget`).
- **Verification:** Vitest unit tests for `ListMemoriesUseCase` (filter serialisation, pagination cursor, forget action) and for the filter → URL search-params mapper. Adapter integration test covers the `/v1/memory/forget` call.
- **Commit:** `feat(web): memories list and filters`

---

**TODO I8 — Manual add memory (MD editor)**
- **Owner:** `frontend-specialist`
- **Scope:** `/memories/new` page with CodeMirror 6 Markdown editor (split pane preview via `unified` + `remark-parse` + `remark-gfm` + `rehype-sanitize`). Metadata side panel: type, scope, repo, language, frameworks (multi), tags (multi), path, symbol, source, author, agent, custom JSON fields. Zod-validate before submit. Server Action calls `CreateMemoryUseCase` → `POST /v1/memory`.
- **Acceptance:** Editor persists draft in `sessionStorage`. Preview sanitised. Submit redirects to the new memory's detail page. Invalid metadata shown inline with field errors.
- **Verification:** Vitest unit tests for `CreateMemoryUseCase` (Zod schema happy + sad paths) and for the metadata-to-DTO mapper. Component test for the form's validation rendering. Manual check in the browser documented in the commit body.
- **Commit:** `feat(web): markdown editor for manual memory creation`

---

**TODO I9 — Query interface (tool response viewer)**
- **Owner:** `frontend-specialist`
- **Scope:** `/query` page. Dropdown to pick a tool: `mb_recall`, `mb_digest`, raw REST endpoint. Form built dynamically from a tool schema in `lib/domain/query.ts`. Submit → Server Action calls the matching orchestrator endpoint and returns both parsed response and raw JSON. Render: collapsible JSON tree + pretty-printed summary + latency.
- **Acceptance:** Every tool request shows response time, status, payload sent, raw JSON, parsed view. Errors rendered with redacted stack.
- **Verification:** Vitest unit tests for `RunQueryUseCase` covering recall, digest, and error paths (orchestrator 4xx/5xx) with a mocked client. Component test asserting the raw-vs-parsed toggle renders.
- **Commit:** `feat(web): query runner for orchestrator tools`

---

**TODO I10 — Graph view**
- **Owner:** `frontend-specialist`
- **Scope:** `/graph` page. Uses React Flow with elkjs layout (in a Web Worker). Nodes = memories, edges = computed relations. Relations source: shared `repo_name`, shared `tags[]`, and embedding similarity > 0.85. Node size ∝ `use_count + vote_bias`. Node colour by `type`. Side panel opens on node click with full metadata + link to `/memories/[id]`. Controls: filter by scope/language, cluster toggle, zoom-to-fit, export PNG.
- **Acceptance:** Handles ≥ 2000 nodes at 30fps on a mid-range laptop. Layout computed off the main thread. Initial data loaded via Server Component; interactive updates via TanStack Query.
- **Verification:** Vitest unit tests for `GetMemoryGraphUseCase` (relation-building, node-size formula) and for the graph-snapshot → React Flow mapper using fixture data. Manual perf check with 2000 synthetic nodes documented in the commit body.
- **Commit:** `feat(web): knowledge graph visualisation`

---

**TODO I11 — Orchestrator: aggregate + graph endpoints**
- **Owner:** `database-specialist` (SQL) + `typescript-specialist` (handler)
- **Scope:** Add two orchestrator endpoints required by dashboard and graph:
  1. `GET /v1/memory/summary` — counts by scope/type/language/framework, totals, top-20 tags. Single SQL with `COUNT(*) FILTER (WHERE …)`.
  2. `GET /v1/memory/graph?limit=&minSimilarity=` — returns `{nodes, edges}`. Edges built from shared repo/tags + optional top-k cosine similarity (bounded by `limit`).
- **Acceptance:** Endpoints gated by `X-Mybrain-Internal-Key`. Query plan inspected — both must hit indexes (`idx_my_brain_memory_metadata_tags`, HNSW). P95 < 500ms on 50k rows. Add handler files under `src/orchestrator/src/http/handlers/`. Update `router.ts`. Extend `src/orchestrator/src/domain/types.ts`.
- **Verification:** Integration test hitting each endpoint with seeded data. `EXPLAIN ANALYZE` output attached to the commit body.
- **Commit:** `feat(orchestrator): summary and graph aggregate endpoints`

> Ordering note: TODO I11 must be completed **before** I6 and I10 can finish end-to-end, but can start in parallel with I3–I5 since it only touches the orchestrator.

---

**TODO I12 — Compose + gateway wiring**
- **Owner:** `docker-specialist` + `devops-specialist`
- **Scope:**
  1. Multistage `Dockerfile` in `src/web/` producing a `node:20-bookworm-slim` runner from Next.js `standalone` output. Non-root user. `HEALTHCHECK` against `/api/health`.
  2. New service `my-brain-web` in `docker-compose.yml`: depends on `my-brain-orchestrator` healthy, internal network only, `expose: 3000`.
  3. Caddy new site block on `:${MYBRAIN_WEB_PORT:-8000}` that: applies `security_headers`, rate-limits `/api/auth/login`, reverse-proxies everything else to `my-brain-web:3000`. No bearer auth at Caddy for this port — the webapp owns its own auth.
  4. Publish port bound to `127.0.0.1` only, consistent with existing bind pattern.
- **Acceptance:** `docker compose up -d --build` brings the whole stack up, including the webapp, and `curl http://127.0.0.1:8000/api/health` returns 200.
- **Verification:** `./src/scripts/smoke-test.sh` extended with a webapp reachability check (or a new script). Compose lint clean.
- **Commit:** `feat(stack): wire my-brain-web into compose and caddy`

---

### 5.2 Testing TODOs (mandatory — never omit)

Scope guidance: v1 is intentionally unit-test-heavy. **No Playwright / E2E / browser automation in v1** — the cost/complexity is not justified for a single-operator tool. Manual browser verification at the end of TODO I5, I6, I7, I8, I9, I10 is acceptable and must be recorded in the commit body. E2E is a candidate for a future iteration once the surface stabilises.

**TODO T1 — Unit tests for domain and use cases**
- **Owner:** `typescript-specialist`
- **Scope:** Vitest. Cover every use case in `lib/application/` with happy + sad paths. Mock ports. Cover domain value objects (`MetadataFields`, `GraphSnapshot`, filter mappers) and Zod schemas. Target > 90% branch coverage in `lib/application/` and `lib/domain/`.
- **Verification:** `pnpm --filter my-brain-web test` green. Coverage report surfaced in the test script output.
- **Commit:** `test(web): unit tests for use cases and domain`

---

**TODO T2 — Adapter + session unit tests**
- **Owner:** `typescript-specialist`
- **Scope:** Test `HttpOrchestratorClient` against a mocked orchestrator using `msw` (Zod-rejection on malformed responses, header injection, error-class mapping). Test the session store (cookie flags, TTL sliding, CSRF helper, bearer encryption-at-rest in the in-memory store). Test the login/logout Route Handlers and the `(authed)` guard by invoking them as functions with mocked cookies and ports — **no browser**.
- **Verification:** `pnpm --filter my-brain-web test` green.
- **Commit:** `test(web): adapter and session unit tests`

---

**TODO T3 — Orchestrator endpoint tests**
- **Owner:** `database-specialist`
- **Scope:** Integration tests for `/v1/memory/summary` and `/v1/memory/graph` using the repo's existing test infra.
- **Commit:** `test(orchestrator): cover summary and graph endpoints`

---

### 5.3 Final Checkup TODOs

**TODO F1 — Security review (blocking)**
- **Owner:** `security-reviewer`
- **Scope:** Review auth (session cookie flags, CSRF, bearer handling, rate limit), dependency CVEs (`pnpm audit`), SSRF (user-controlled URLs?), XSS in Markdown preview (confirm `rehype-sanitize` schema), secret exposure (no bearer in client bundle — grep `.next/standalone` for the token env var name). Must produce actionable findings and apply fixes before close.
- **Commit:** `fix(web): apply security review remediations` (only if changes needed)

---

**TODO F2 — Performance review**
- **Owner:** `frontend-specialist` + `database-specialist`
- **Scope:** Next.js build-time bundle analyser (≤ 200KB gzipped per non-graph route), manual Lighthouse run on the dashboard (perf ≥ 90; graph exempt) with the number recorded in the commit body, orchestrator `EXPLAIN ANALYZE` on the two new endpoints.

---

**TODO F3 — Architecture review**
- **Owner:** `design-architect`
- **Scope:** Verify hexagonal boundaries: domain has no infra imports, application has no framework imports, UI never touches infra directly. Run `eslint-plugin-boundaries`. File sizes within limits.

---

**TODO F4 — Documentation Completion Step (blocking — final gate)**
- **Owner:** `documentation-specialist`
- **Scope:** Enforce `~/.claude/rules/commenting-standards.md`. Apply skills: `commenting-standards`, `documentation-best-practices`, `typescript-documentation-best-practices`.
  - Every new class/module/function/method/exported type has a contract-level docblock.
  - Inline comments only where intent is non-obvious; no syntax narration.
  - Update `README.md` root with a "Webapp" section (URL, login flow, troubleshooting).
  - Update `docs/technical/architecture.md` with the webapp hexagon, auth flow diagram, and the two new orchestrator endpoints.
  - Update `docs/runbooks/local-operations.md` with how to open the webapp and rotate `MYBRAIN_WEB_SESSION_SECRET`.
  - Add `src/web/AGENTS.md` mirroring other sub-packages.
- **Acceptance:** `documentation-specialist` returns no remaining findings.
- **Commit:** `docs(web): contract docs, runbook and architecture notes`

---

**TODO F5 — Lint / format / build / typecheck**
- **Owner:** `devops-specialist`
- **Scope:** `pnpm install` → `pnpm run lint` → `npx prettier --check .` → `pnpm -r run typecheck` → `pnpm -r run build` → `pnpm -r run test` → `docker compose build`. All green. If anything fails, loop back to the responsible TODO.
- **Commit:** `chore: final lint/build/test pass` (if cleanup needed)

---

## 6. Stop Condition

Task is complete only when **all** of the following are true:

- All I1–I12 implementation TODOs done with atomic commits.
- All T1–T3 testing TODOs done with atomic commits.
- F1–F5 Final Checkup TODOs done with atomic commits where fixes were needed.
- Documentation Completion Step (F4) returns no findings.
- `docker compose up -d --build` brings the full stack up and the webapp is reachable at `http://127.0.0.1:${MYBRAIN_WEB_PORT}`.
- A user can: log in with the master token → see the dashboard → view the graph → add a memory via the MD editor → run a query → log out.
- Reviewer subagents (F1–F3) have signed off and their fixes are committed.

---

## 7. Executor Checklist (print this and tick as you go)

- [ ] Read all files in section 0.
- [ ] Invoked `workflow-orchestrator`, `design-architect`, `security-reviewer` per section 4.
- [ ] TODO I1 complete + committed.
- [ ] TODO I2 complete + committed.
- [ ] TODO I3 complete + committed.
- [ ] TODO I4 complete + committed.
- [ ] TODO I5 complete + committed.
- [ ] TODO I11 complete + committed (orchestrator endpoints).
- [ ] TODO I6 complete + committed.
- [ ] TODO I7 complete + committed.
- [ ] TODO I8 complete + committed.
- [ ] TODO I9 complete + committed.
- [ ] TODO I10 complete + committed.
- [ ] TODO I12 complete + committed.
- [ ] TODO T1–T3 complete + committed.
- [ ] TODO F1 security review + remediations committed.
- [ ] TODO F2 performance review + remediations committed.
- [ ] TODO F3 architecture review + remediations committed.
- [ ] TODO F4 documentation completion step committed.
- [ ] TODO F5 final lint/build/test pass committed.
- [ ] End-to-end smoke verified manually.

---

## 8. Anti-patterns to reject (from `~/.claude/rules`)

- No `utils.ts` / `helpers.ts` / `types/index.ts` dumping grounds.
- No files > 300 logic lines without a declarative-data exemption.
- No comments that restate syntax. Docblocks must state **contract**, inline comments must state **why**.
- No removal of unfamiliar code without applying Chesterton's Fence (research `git log` + call sites first).
- No destructive git operations. Always atomic commits per TODO.
- No fake test coverage: tests must assert behaviour, not the implementation.
- No bearer token in any client-side artefact — `grep` the build output before shipping.

---

## 9. Open questions the executor must resolve before starting

1. Does "same docker container as the entire project" allow a new Compose **service** (this plan's assumption) or does the user truly want a single container? — **Ask before TODO I1.**
2. Is a subpath mount (`/app/*` on port 8080) preferable to a dedicated port (`:8000`)? — **Ask before TODO I12.**
3. Should the login screen also offer OIDC/GitHub OAuth for future multi-user operation, or is single-operator-with-master-token sufficient for v1? — **Ask before TODO I4.** Default assumption: single-operator v1.

Stop and ask the user for any open question. Do not proceed past TODO I1 until they are resolved.
