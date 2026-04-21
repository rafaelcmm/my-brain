# my-brain — Re-Simulation Report (post-optimization, 2026-04-20)

> Second live walk of the stack after the commits that landed the `mb_*`
> tool surface, metadata envelope, scoped recall, feedback loop, and
> rule set. Every claim below is backed by an actual MCP `tools/call`
> response collected during this session against
> `http://127.0.0.1:3333/mcp`.

---

## 0. Stack state at test time

```
my-brain-db             ruvnet/ruvector-postgres:latest  healthy
my-brain-llm            ollama/ollama:latest             healthy
my-brain-orchestrator   my-brain/orchestrator:local      healthy
my-brain-mcp            my-brain/mcp-bridge:local        healthy   (was: running)
my-brain-gateway        caddy:2-alpine                   running
```

`tools/list` returns **105 tools** (was 97). The 8 new tools are:
`mb_context_probe`, `mb_remember`, `mb_recall`, `mb_vote`, `mb_forget`,
`mb_session_open`, `mb_session_close`, `mb_digest`.

`hooks_capabilities` is unchanged:

```json
{
  "engine": false, "vectorDb": false, "sona": false,
  "attention": false, "embeddingDim": 64
}
```

So: plumbing widened dramatically, intelligence layer **still not
loaded**. Recall scoring is still 64-dim hash bag-of-words on brute
force. Metadata routing is the only thing keeping quality afloat.

---

## 1. What improved since v0.1

### 1.1. Tool surface — full ✅

All 8 `mb_*` tools respond 200 with the schemas promised in the plan:

| Tool                | Verified behavior                                               |
|---------------------|-----------------------------------------------------------------|
| `mb_context_probe`  | Returns `{repo, repo_name, project, language, frameworks,...}` |
| `mb_remember`       | Accepts `{content, type, scope, metadata}`; returns `memory_id` |
| `mb_recall`         | `scope`/`repo`/`project`/`language`/`frameworks`/`tags`/`type`/`include_expired`/`min_score` filters honored |
| `mb_vote`           | `{memory_id, direction, reason}` accepted                       |
| `mb_forget`         | `soft` mode removes entry from subsequent recall                |
| `mb_session_open`   | Returns a `session_id`                                          |
| `mb_session_close`  | Accepts `{session_id, success, quality, reason}`                |
| `mb_digest`         | Aggregates counts by `type × language × repo_name`              |

### 1.2. Metadata envelope — stored and returned ✅

`mb_recall` now returns the full envelope per result:

```json
{
  "id": "mem-...-iadzv9mr1",
  "content": "In Go project foo-service we use errors.Is ...",
  "type": "convention", "scope": "repo", "score": 0.207,
  "metadata": {
    "repo": "github.com/acme/foo-service",
    "repo_name": "foo-service", "project": "app",
    "language": "go", "frameworks": [],
    "tags": ["errors","idiom"],
    "created_at": "2026-04-20T21:47:28.716Z",
    "expires_at": null
  }
}
```

This is the single biggest win: LLMs can now see *where* a memory came
from and filter/weight it accordingly. `mb_digest` confirms the index
is rich enough for the curator to reason over type/language/repo.

### 1.3. Empty-result policy — honored ✅

- Query `"kubernetes ingress config"` with `min_score=0.5` → `"results": []`
- Query `"useEffect cleanup async"` with language/framework filters and
  default threshold → `"results": []` (no padding).

In v0.1 the system *always* returned 5 noisy matches. It now correctly
returns nothing when nothing is above threshold. The
`memory-retrieval.md` rule is actually enforced at the server.

### 1.4. Session lifecycle — wired ✅

`mb_session_open` → `mb_session_close(success,quality,reason)` completes
cleanly and replaces the ghost `session_start`/`session_end` the v0.1
skills referenced. SONA gets a real trajectory handle.

### 1.5. Soft-forget — works ✅

After `mb_forget(mode="soft")` on the React-cleanup memory,
`mb_recall` no longer surfaces it. The entry is hidden from retrieval
without losing the underlying content for audit.

### 1.6. Skills and agents — migrated ✅

- `.claude/skills/` now has 5 entries: `context`, `capture`, `recall`,
  `session`, `feedback`. `my-brain-feedback` is new.
- `.claude/agents/my-brain-curator.md` now calls
  `hooks_capabilities`, `hooks_stats`, `mb_recall`, `mb_digest` — all
  real, all working.
- `.claude/rules/memory-hygiene.md` and `memory-retrieval.md` encode
  dynamic threshold (0.6 engine=true, 0.85 degraded) and metadata
  requirements.

### 1.7. CI + hardening ✅

- `ci(quality): validate tool ids and add integration smoke` — prevents
  skills from drifting to non-existent tool names like the v0.1
  `session_start` ghost.
- `fix(security): enforce token policy and memory guardrails`.
- `fix: finalize readiness and validation hardening`.

---

## 2. What did NOT improve

### S1 — still blocking

1. **Engine still disabled.** `hooks_capabilities.engine=false`. The
   orchestrator bootstrap commit (`97f996e`) added a `/v1/capabilities`
   endpoint, but the runtime still advertises `embeddingDim: 64`,
   hash embeddings, brute-force vector DB. The commit title
   "bootstrap runtime" is misleading — `@ruvector/ruvllm`,
   `@ruvector/pi-brain`, Ollama embedding endpoint, and the Postgres
   vector store are **not wired**.

2. **Recall quality is still broken in absolute terms.** Query
   `"pnpm package manager"` with no filters:

   | rank | score | content                                                       |
   |------|-------|---------------------------------------------------------------|
   | 1    | 0.207 | Go `errors.Is` convention (wrong)                             |
   | 2    | 0.199 | Postgres VACUUM (wrong)                                       |
   | 3    | 0.183 | Python torch.compile (wrong)                                  |
   | 4    | 0.171 | React useEffect (wrong)                                       |
   | 5    | 0.162 | **my-brain pnpm 9.15.4** (correct — last place)              |

   Same v0.1 failure mode: the hash embedder has no semantic signal.
   Scoped filters mask this (tight `repo`+`language` returns empty
   instead of wrong), but every unscoped query is still noise.

3. **`brain_*` namespace still disabled.**
   `brain_status` → `"Brain tools require @ruvector/pi-brain"`. Same
   for search, share, get, list, drift, partition, transfer, sync.
   The curator and skills were correctly migrated away from these;
   the tools themselves remain dead weight on `tools/list`.

### S2 — new findings

4. **No server-side dedup.** Storing the same pnpm rule three times
   created three distinct memory IDs; all three appear in recall at
   identical scores. The `memory-hygiene.md` rule lists a `0.6`/`0.85`
   dedup threshold but it is not enforced at the `mb_remember`
   boundary. Skill-side dedup via `mb_recall`→score check would work if
   the embedder were real; on a 64-dim hash it is unreliable.

5. **`mb_context_probe` is effectively a stub.** Input schema is
   `{refresh?}` only. It does not accept `cwd`, `git_remote`, or any
   client-side hint. The server always reports:

   ```json
   { "project": "app", "language": "javascript", "repo": null,
     "repo_name": null, "source": "conversation:2026-04-20" }
   ```

   That is the orchestrator's own filesystem (`/app` inside the
   container with a `package.json` at root). Every consumer today has
   to bypass the probe and pass metadata explicitly to `mb_remember` /
   `mb_recall`. The probe is therefore dead-on-arrival.

6. **`include_expired` does not gate soft-forgotten entries.** The
   React memory was soft-forgotten; `mb_recall` with
   `include_expired=true` still does not surface it. Soft-forget and
   expiry are two different gates, but the tool exposes only one. A
   curator cannot audit redacted content without a second flag
   (`include_redacted` or `include_forgotten`).

7. **`scope`/`repo` filter rejects when `repo_name` is set but `repo`
   (full URL) is null.** One of my duplicate stores used only
   `repo_name`; `mb_recall(scope=repo, repo="github.com/.../my-brain")`
   missed that entry. The filter keys on `repo` URL, not
   `repo_name`. For a developer brain this is fragile: most memories
   are captured from local work where the git remote may be missing
   (no upstream, monorepo subdir, detached HEAD).

### S3 — operational

8. **Token still 20 chars.** `.secrets/auth-token` is `20` bytes
   (including trailing newline, so 19-char token). The token-policy
   commit (`15fdcd0`) enforces a minimum — but the minimum passed.
   The plan asked for ≥64 chars. Either install.sh was not re-run or
   the policy threshold is too lenient.

9. **97 legacy tools still advertised.** `tools/list` shows 105 tools.
   97 of them still route to dead `@ruvector/*` code paths. LLMs with
   no allow-list will discover and call them, waste turns on errors.
   The `mcp-bridge` should either hide them when the engine is off or
   rewrite them to a single "engine disabled" no-op.

10. **`mb_context_probe.source` field is placeholder.** Returns
    `"conversation:2026-04-20"`, which is a hard-coded date, not a
    real source. Curator/audit surfaces cannot rely on it.

---

## 3. Verdict

v0.1 → v0.2 delivered the **interface** of the optimization plan: the
`mb_*` surface, the metadata envelope, the empty-result policy, the
skill/agent migration, the rule files, CI tool-id validation. This is
a real step up — any LLM that *uses these tools correctly* will no
longer be actively misled by recall padding and has a path to build up
a scoped memory store.

What was **not** delivered is the intelligence: the engine, the
embedder, the vector DB, the `brain_*` semantic stack. Without them,
recall ranking is still noise-dominated. The metadata scope filters
are the *only* thing preventing low-quality context from reaching the
LLM — which works in the degenerate "ask for memories in exactly this
repo and this language" case, but does not make the LLM *smarter*
across a developer's daily workflow.

---

## 4. Recommendations — ranked fix list

### P0 — unlock real recall quality (one week of work)

**R1. Boot the real engine in the orchestrator.**
`src/orchestrator/src/index.mjs` currently exposes `/health` +
`/v1/status` + `/v1/capabilities` only. It needs to:

- import `@ruvector/ruvllm` and `@ruvector/server` (or pi-brain);
- initialize the embedder against the Ollama sidecar (`qwen3-embedding:0.6b`,
  1024-dim) via `OLLAMA_URL` env;
- initialize the vector store against the `ruvector-postgres` container
  (HNSW backend);
- expose `/v1/embed`, `/v1/recall`, `/v1/remember` that `mb_*` already
  stubs out behind HTTP;
- flip `hooks_capabilities.engine=true` only when all three pass a
  warm-up check.

Acceptance: `hooks_capabilities` reports `engine:true, vectorDb:true,
embeddingDim:1024`. A query `"pnpm package manager"` ranks the pnpm
memory as result #1 at score ≥ 0.7.

**R2. Server-side dedup on `mb_remember`.**
Before inserting, compute embedding + run nearest-neighbor query scoped
to `(repo, scope, type)`. If top hit ≥ `0.85` (degraded) or `0.6`
(engine=true) *and* normalized content matches on SHA-1 bucket,
increment a `use_count` + `last_seen_at` on the existing row, return
its `memory_id`. Emit `{deduped: true, matched_id}` in the response.

Acceptance: storing the same pnpm rule three times produces exactly
one row; `mb_recall` returns one result; `use_count=3`.

**R3. Hide or gate dead tools when engine=false.**
`mcp-bridge` already passes through hooks. When
`hooks_capabilities.engine=false`, filter `tools/list` to exclude the
`brain_*` namespace. LLMs should never see a tool that is guaranteed
to fail.

### P1 — fix the metadata contract (2–3 days)

**R4. Rewrite `mb_context_probe`.**
Add `cwd`, `git_remote`, `language_hint`, `repo_hint` to the schema.
Either (a) the client passes these (Claude skill already has
`git remote -v` and manifest sniffing available in a Bash tool) or
(b) if the client cannot, the probe falls back to the current stub and
clearly marks `source: "server-fallback"`.

Acceptance: from the `my-brain` repo, probe returns
`{repo_name: "my-brain", project: "my-brain", language: "typescript",
frameworks: ["docker","node"]}`. From an empty cwd, returns
`{source: "server-fallback"}` and never reports `project: "app"`.

**R5. Normalize `repo` matching.**
`mb_recall(scope=repo, repo=X)` should match when **any** of
`metadata.repo == X`, `metadata.repo_name == X`, or
`metadata.repo_name == basename(X)`. Developers rarely pass the full
`git remote.origin.url` identically across memories.

Acceptance: the two pnpm memories (one with URL, one with only
`repo_name`) both match a single recall query.

**R6. Split forget/expire semantics.**
Add `include_redacted` and `include_forgotten` flags to `mb_recall`,
distinct from `include_expired`. The curator needs to audit each axis
independently.

### P2 — feedback loop and ergonomics (2–3 days)

**R7. Wire `mb_vote` into the learning path.**
Today `mb_vote` returns `success: true` but there is no observable
effect on subsequent recall. It should:

- adjust the memory's score prior (additive bias) in recall;
- feed `hooks_force_learn` / SONA once the engine is real;
- be surfaced in `mb_digest` (e.g. `votes_up`, `votes_down` columns).

**R8. Rotate the token.**
Run `install.sh --rotate` or its equivalent. Confirm `.secrets/auth-token`
is ≥64 chars. Fail-close the gateway on short tokens at startup (today
it only enforces "non-empty"). Document the minimum in the README.

**R9. Give `mb_context_probe` real `source`.**
Stop hard-coding `"conversation:YYYY-MM-DD"`. Return the actual
derivation source: `git`, `package.json`, `cargo.toml`, `pyproject`,
`fallback`.

### P3 — once engine is loaded

**R10. SONA + trajectory + ReasoningBank.**
With the engine live, re-run this simulation and confirm:

- `hooks_learning_stats` returns non-error JSON;
- trajectories recorded in `mb_session_*` measurably alter
  `hooks_route` confidence (today stuck at `0.5 default mapping`);
- repeated failed recalls (low score + downvote) decay and stop
  resurfacing.

**R11. Observability.**
Add `/metrics` to orchestrator + mcp-bridge (Prometheus-style), with
counters for `mb_remember_total`, `mb_recall_total{hit,miss}`,
`mb_dedup_hits_total`, `mb_forget_total{soft,hard}`. Without this the
curator is flying blind past ~100 memories.

---

## 5. Quick scorecard

| Area                          | v0.1           | v0.2 (now)           |
|-------------------------------|----------------|----------------------|
| Tool count                    | 97             | 105 (+8 `mb_*`)      |
| Metadata on writes            | none           | full envelope ✅      |
| Scope/repo/language filters   | none           | honored ✅            |
| Empty-result policy           | always padded  | empty when nothing ✅ |
| Session lifecycle             | ghost tools    | `mb_session_*` ✅     |
| Skills + curator              | broken refs    | migrated ✅           |
| Rules (`.claude/rules/`)      | none           | hygiene + retrieval ✅|
| CI tool-id validation         | none           | added ✅              |
| Engine loaded                 | ❌              | ❌ (still)            |
| Semantic recall quality       | ❌              | ❌ (still)            |
| Server-side dedup             | ❌              | ❌ (still)            |
| `mb_context_probe` accurate   | n/a            | ❌ (stubbed)          |
| Token ≥ 64 chars              | ❌ (20)         | ❌ (20)               |

---

## 6. Bottom line

The v0.2 delta is the right kind of work: it makes the system **safe
to use** by making its failure modes explicit (empty results, scoped
filters, soft-forget, rules) and by giving LLMs a contract
(`mb_*` + metadata) that will still be correct once the engine is
loaded.

But the advertised superpower — "LLMs improving daily by self-learning
on top of semantic memory" — requires the engine. Until R1 lands,
this is a well-structured filing cabinet with a broken search box.

Follow-up: apply R1–R3 and re-run the same stress suite. Expected
outcome: query `"pnpm package manager"` ranks the correct pnpm memory
at #1 with score ≥ 0.7; 3 identical writes collapse to one row;
`tools/list` drops the `brain_*` entries when engine is off.
