# my-brain — State of the Tool v2

**Date:** 2026-04-22  
**Scope:** remediation pass on v1 findings, engine-readiness investigation, and fresh stress benchmark rerun.  
**Runtime under test:** orchestrator (TS, local port 8091) + ruvector 0.3.0 Postgres (port 5433, tmpfs).

---

## 1. Purpose

This v2 report follows the same structure as `knowledge/state-of-the-tool.md` and focuses on:

- Fixing high-impact blockers from v1 (engine fallback, DB bootstrap mismatch, infrastructure file overgrowth).
- Verifying that default runtime behavior now exposes `engine=true` when intelligence engine is available.
- Re-running stress benchmarks and comparing against v1.

---

## 2. Code-quality audit (after remediation)

### 2.1 Gates executed

| Gate                                                                       | Result                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm install`                                                              | ❌ fails (`ERESOLVE` in this monorepo layout)                                                 |
| `pnpm install`                                                             | ✅ pass                                                                                       |
| `pnpm typecheck`                                                           | ✅ pass                                                                                       |
| `pnpm lint`                                                                | ✅ pass                                                                                       |
| `pnpm test`                                                                | ✅ pass (bridge + orchestrator unit tests)                                                    |
| `TEST_DB_URL=... pnpm --filter my-brain-orchestrator run test:integration` | ✅ 11/11 pass                                                                                 |
| `docker compose config`                                                    | ✅ pass                                                                                       |
| `./src/scripts/security-check.sh`                                          | ✅ critical checks pass (non-critical warnings only)                                          |
| `./src/scripts/smoke-test.sh`                                              | ❌ fails in this run (`000`) because full gateway/orchestrator container stack is not running |

### 2.2 Resolved findings from v1

| ID                                                      | Status      | Change                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 (`src/db/init/01-enable-extension.sql`)              | ✅ Resolved | Removed hard pin `VERSION '0.1.0'`; removed unsupported `ruvector_enable_learning(true)`; guarded startup notice for extension version function.                                          |
| F2 (engine stuck degraded due package/load path issues) | ✅ Resolved | Pinned orchestrator dependency to `ruvector@0.2.22`; added resilient loader fallback (`ruvector` then `ruvector/dist/index.js`); added explicit startup diagnostics in intelligence init. |
| Engine default false despite usable engine              | ✅ Resolved | Updated readiness/capability gate so `engine` tracks actual intelligence-engine + DB readiness, not Ollama warmup success alone.                                                          |
| F3 (`postgres-memory.ts` too large)                     | ✅ Resolved | Split into focused modules under `src/orchestrator/src/infrastructure/postgres-memory/` and kept stable facade import surface.                                                            |
| F6 (dead import pin in router)                          | ✅ Resolved | Removed dead `void normalizeDigestSince` pattern and stale import.                                                                                                                        |
| F7 (`parseBoolean` strictness)                          | ✅ Resolved | Added support for `1/0`, `yes/no`, `on/off`, case-insensitive parsing.                                                                                                                    |
| F8 (non-null assertions in envelope validation)         | ✅ Resolved | Replaced with explicit narrowing guard.                                                                                                                                                   |
| F9 (stale eslint ignore)                                | ✅ Resolved | Removed obsolete `legacy-index.mjs` ignore.                                                                                                                                               |

### 2.3 Engine fallback root-cause analysis

`engine=false` in v1 was multi-cause:

1. **Dependency drift at workspace root lockfile level**: root lock resolved `ruvector@0.2.23`, whose published package had broken main-entry behavior in this environment.
2. **Silent degradation during initialization**: failed intelligence load pushed degraded mode, but diagnostics were weak.
3. **Capability gating coupled to embedding warmup**: `engine` was previously tied to `state.embedding.ready`; if Ollama warmup failed, capabilities still advertised `engine=false` even with intelligence engine loaded and usable fallback embeddings.

Remediation outcome:

- Capabilities now report `engine=true` with DB+engine healthy, even when embedding warmup degrades.
- Example observed payload after fix:
  - `capabilities.engine = true`
  - `degradedReasons` still include embedding/auth-token warnings in local standalone run.

---

## 3. Stress benchmarks (rerun)

### 3.1 Environment

- Host: Linux, Node 25.8.
- Postgres 16 + ruvector 0.3.0 on port 5433 (`docker-compose.test.yml`, tmpfs).
- Core benchmark harness: `.bench/bench-core.mjs`.
- HTTP benchmark harness: `.bench/bench-http.mjs` against local orchestrator on `http://127.0.0.1:8091`.

### 3.2 Fresh results

#### 3.2.1 Seed + core recall/dedup

| Corpus | Concurrency | Seed wall | Seed writes/s |
| ------ | ----------- | --------- | ------------- |
| 2 000  | 16          | 5.424 s   | **368.7**     |
| 10 000 | 24          | 75.011 s  | **133.3**     |

| Corpus | rps (recall) | avg       | p50       | p95       | p99       | max       |
| ------ | ------------ | --------- | --------- | --------- | --------- | --------- |
| 2 000  | **181.7**    | 87.51 ms  | 81.53 ms  | 145.01 ms | 194.31 ms | 245.50 ms |
| 10 000 | **157.3**    | 151.69 ms | 135.50 ms | 238.83 ms | 299.90 ms | 372.37 ms |

| Corpus | rps (dedup) | avg       | p50       | p95       | p99       | max       |
| ------ | ----------- | --------- | --------- | --------- | --------- | --------- |
| 2 000  | **143.7**   | 110.07 ms | 105.42 ms | 199.74 ms | 215.96 ms | 220.16 ms |
| 10 000 | **138.8**   | 169.74 ms | 165.39 ms | 205.81 ms | 348.28 ms | 353.07 ms |

#### 3.2.2 HTTP route benchmark

| Route                    | n   | rps    | avg       | p50       | p95       | p99       | max       | Status mix      |
| ------------------------ | --- | ------ | --------- | --------- | --------- | --------- | --------- | --------------- |
| `GET /v1/capabilities`   | 400 | 2076.7 | 6.56 ms   | 5.62 ms   | 17.17 ms  | 22.69 ms  | 42.08 ms  | 200=400         |
| `GET /metrics`           | 400 | 4681.0 | 3.36 ms   | 2.97 ms   | 5.85 ms   | 6.60 ms   | 6.67 ms   | 200=400         |
| `POST /v1/memory/digest` | 400 | 1906.5 | 8.28 ms   | 4.33 ms   | 25.30 ms  | 51.74 ms  | 53.70 ms  | 200=60, 429=340 |
| `POST /v1/context/probe` | 200 | 133.4  | 115.23 ms | 103.84 ms | 215.38 ms | 227.57 ms | 228.30 ms | 200=200         |
| `POST /v1/session/open`  | 100 | 189.9  | 42.08 ms  | 61.60 ms  | 78.79 ms  | 82.67 ms  | 82.67 ms  | 200=60, 429=40  |
| `POST /v1/memory/vote`   | 400 | 3364.4 | 4.60 ms   | 4.43 ms   | 8.74 ms   | 9.64 ms   | 9.67 ms   | 400=60, 429=340 |

### 3.3 Comparison vs v1

- Core performance is effectively stable with small variance (within expected benchmark noise):
  - 2k recall rps: 179.9 → **181.7** (+1.0%)
  - 10k recall rps: 158.0 → **157.3** (-0.4%)
  - 10k seed writes/s: 131.2 → **133.3** (+1.6%)
- Main v2 win is **correct runtime behavior and diagnosability**, not raw throughput shift:
  - `engine=true` now accurately reflects available memory engine capability.
  - DB bootstrap now matches current extension image.
  - infrastructure module split reduces maintenance risk.

---

## 4. Current status of prior risk list

### 4.1 Addressed this pass

- Engine default/fallback logic corrected.
- DB extension bootstrap compatibility corrected.
- Large infra file split completed.
- Small correctness/polish findings removed.

### 4.2 Remaining items (not completed in this pass)

| ID  | Severity | Location                                              | Remaining work                                                          |
| --- | -------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| F4  | Medium   | `src/orchestrator/src/policies/rate-limit.ts`         | Add bucket expiry and bounded map growth.                               |
| F5  | Medium   | `src/orchestrator/src/observability/metrics.ts`       | Move module-global state into injectable registry + cardinality guards. |
| F10 | Info     | `src/orchestrator/src/http/handlers/memory-recall.ts` | Split filter normalization/scoring orchestration when next changed.     |

---

## 5. Follow-up guide (v2)

### P0

1. Keep `ruvector` pinned until upstream publish quality is stable and validated in CI.
2. Add CI assertion that `/v1/capabilities` returns `engine=true` in controlled DB+engine fixture.

### P1

3. Implement rate-limit bucket TTL + max-size cap.
4. Refactor metrics to instance registry with reset hooks for test isolation.

### P2

5. Split `memory-recall.ts` when next touched.
6. Add end-to-end smoke in CI with full compose profile to make `smoke-test.sh` mandatory in automation.

---

## 6. Appendix — fresh logs

Raw logs saved to:

- `/tmp/mb-stress/bench-2k-v2.log`
- `/tmp/mb-stress/bench-10k-v2.log`
- `/tmp/mb-stress/bench-http-v2.log`
- `/tmp/mb-stress/docker-compose-config-v2.txt`

Baseline logs from v1 remain available in:

- `/tmp/mb-stress/bench-2k.log`
- `/tmp/mb-stress/bench-10k.log`
- `/tmp/mb-stress/orch.log`
