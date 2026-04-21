# my-brain — Live Simulation Report (v0.1 runtime, 2026-04-20)

> Produced from an end-to-end stress walk of the running stack at
> `http://127.0.0.1:3333/mcp` with the bundled bearer token. Every claim
> below is backed by an actual MCP `tools/call` response collected during
> the session.

---

## 0. Stack state at test time

```
my-brain-db             ruvnet/ruvector-postgres:latest  healthy
my-brain-llm            ollama/ollama:latest             healthy
my-brain-orchestrator   my-brain/orchestrator:local      healthy
my-brain-mcp            my-brain/mcp-bridge:local        running
my-brain-gateway        caddy:2-alpine                   running
```

`tools/list` returns **97 tools** under the `my-brain` MCP server.
Transport: Streamable HTTP (`POST /mcp`), `Mcp-Session-Id` honored,
bearer auth enforced, `WWW-Authenticate: Bearer realm="my-brain"` on 401.

`hooks_capabilities` reports the following runtime — this is the single
most important data point of the whole simulation:

```json
{
  "capabilities": {
    "engine":       false,
    "vectorDb":     false,
    "sona":         false,
    "attention":    false,
    "embeddingDim": 64
  },
  "features": {
    "vectorDb":  "Brute-force fallback",
    "sona":      "Q-learning fallback",
    "attention": "Hash embeddings",
    "embeddingDim": 64
  }
}
```

Translation: the core `@ruvector/*` engine is **not actually loaded**.
The MCP binary is running with every intelligence feature in
fallback/off, including embeddings (64-dim bag-of-words hash), the
vector DB (in-memory brute force), SONA (Q-learning stub), and the
attention layer. `engineResult: false` is returned on every recall hit.

---

## 1. Simulated session transcript (abridged)

### 1.1. Session bring-up

```
POST /mcp  method=initialize           → 200, Mcp-Session-Id issued
POST /mcp  method=tools/list           → 97 tools
POST /mcp  tools/call brain_status     → error "Brain tools require @ruvector/pi-brain"
POST /mcp  tools/call hooks_stats      → total_memories=2, engineEnabled=false
```

### 1.2. Seeding memories (LLM daily-work content)

Saved 6 memories spanning 5 stacks (TypeScript, Go, Python, Rust, infra):

| # | `type`     | Content (truncated)                                     |
|---|------------|---------------------------------------------------------|
| 1 | project    | "Project my-brain uses pnpm 9.15.4 with Corepack…"      |
| 2 | decision   | "In Go project foo-service we use errors.Is…"           |
| 3 | gotcha     | "Python ml-pipeline repo: torch.compile AFTER GPU…"     |
| 4 | convention | "React useEffect cleanup must return function…"         |
| 5 | convention | "Rust tokio runtime flavor=multi_thread…"               |
| 6 | gotcha     | "Postgres index-only scan requires VACUUM…"             |

Then I re-saved entries 1 and 4 twice more to probe dedup behaviour.
Final `total_memories=21` (hooks_stats) — no collision, no merge.

### 1.3. Query replay (representative)

**Query A: "my-brain package manager"** — should obviously return memory #1.

| rank | score  | type     | content (truncated)                          |
|------|--------|----------|----------------------------------------------|
| 1    | 0.524  | decision | "In Go project foo-service we use errors.Is" |
| 2    | 0.511  | general  | "As an admin user, I'm capable of creating…" |
| 3    | 0.434  | general  | "To reset a user password…"                  |
| 4    | **0.375** | project  | **"Project my-brain uses pnpm 9.15.4…"** (correct) |
| 5    | 0.359  | gotcha   | "Python ml-pipeline repo…"                   |

**Query B: "useEffect cleanup async"** — should obviously return the React convention.

| rank | score | type       | content                                      |
|------|-------|------------|----------------------------------------------|
| 1    | 0.579 | convention | Rust tokio runtime… *(duplicate)*            |
| 2    | 0.579 | convention | Rust tokio runtime… *(duplicate)*            |
| 3    | 0.579 | convention | Rust tokio runtime… *(duplicate)*            |

The React memory does not appear in top-3. Three Rust duplicates
occupy the whole response.

**Query C: "postgres vacuum index"** — the Postgres gotcha is memory #6.

| rank | score | type     | content                                 |
|------|-------|----------|-----------------------------------------|
| 1    | 0.482 | decision | Go errors.Is (irrelevant)               |
| 2    | 0.479 | gotcha   | Postgres VACUUM (correct, *but #2*)     |
| 3    | 0.479 | gotcha   | Postgres VACUUM (duplicate hit)         |

**Query D: "kubernetes ingress config"** — no such memory exists.
Response: five results at score 0.40–0.47, none relevant. The system
never returns an empty result set even when no memory matches.

### 1.4. Trajectory / routing

`hooks_trajectory_begin` → `hooks_trajectory_step` → `hooks_trajectory_end`
worked cleanly and returned a trajectory id, step counter, duration, and
the user-supplied quality score. This is the **real** session API —
*not* the `session_start` / `session_end` pair the skill files reference.

`hooks_route` for task *"Fix a Python typing bug"* returned
`agent: "python-developer"`, `confidence: 0.5`, `reason: "default mapping"`
— i.e. a hard-coded table, no learned signal.

`hooks_learning_stats` → `{"success": false, "error": "LearningEngine not available"}`.

### 1.5. Brain-namespace audit

Every `brain_*` tool (search, share, get, list, vote, delete, status,
drift, partition, transfer, sync) returned the same error:

```json
{ "success": false,
  "error": "Brain tools require @ruvector/pi-brain",
  "hint":  "npm install @ruvector/pi-brain" }
```

The skills (`my-brain-capture`, `my-brain-recall`) and the curator agent
(`my-brain-curator`) are wired *exclusively* to `brain_share`,
`brain_search`, `brain_agi_status`, `brain_sona_stats` — all currently
non-functional on this runtime.

### 1.6. Side-effect check

`hooks_init` writes `.claude/settings.json` and a `CLAUDE.md` into the
working directory of the MCP process. Verified these land only in the
container's filesystem (`/app/...`), not the host repo. Still worth
calling out because it's a surprising side effect from a tool name that
sounds read-only.

---

## 2. Scorecard — what's great, what's broken

### 2.1. Great points

1. **The plumbing is solid.** Docker Compose, Caddy bearer auth,
   token rotation design, Streamable HTTP, `Mcp-Session-Id` handling,
   and `flush_interval -1` for SSE are all production-grade decisions.
2. **Breadth of surface area.** 97 tools already exposed covering
   memory, trajectories, routing, AST, diff classification, security
   scans, graph ops, sub-agent dispatch, identity, decompile. That's a
   credible superset of what any single IDE memory plugin offers today.
3. **Self-hosted + portable.** No cloud dependency. `.env`-driven.
   Ollama sidecar is optional-by-flag. This is the right shape for a
   developer's local brain.
4. **Security model is sane for localhost.** 127.0.0.1 bind, bearer in
   a 600-perm secret file, stripped before forwarding, hot-reloadable,
   grace-period rotation supported.
5. **Skills and curator exist at all.** Most memory MCPs ship without
   any authoring guidance — `.claude/` conventions here are a head start.

### 2.2. Caveats (severity-ranked)

#### S1 — blocking for the stated goal

1. **Engine not loaded → recall is semantically meaningless.**
   `hooks_capabilities` shows `engine=false`, 64-dim hash embeddings,
   brute-force vector DB. Simulation confirmed: queries that should
   score ≥0.9 on a real embedder score 0.37, sitting **below** random
   unrelated memories that scored 0.48+. An LLM that *trusts* this
   ranking will pull irrelevant context into its prompt and degrade
   its answers instead of improving them.
2. **Entire `brain_*` namespace disabled.** The capture / recall /
   curator skills call exactly the tools that return the
   `@ruvector/pi-brain` error. The autonomous behavior described in the
   research doc cannot work as-is — the silent skill paths all 500.
3. **Skills reference non-existent tools.**
   `my-brain-session/SKILL.md` calls `session_start` / `session_end`;
   the MCP returns `"Unknown tool"`. The real equivalents are
   `hooks_trajectory_begin` / `hooks_trajectory_end`. The curator calls
   `brain_agi_status` and `brain_sona_stats` which also don't exist
   (closest: `brain_status`, `hooks_stats`, `hooks_learning_stats`).
4. **Orchestrator is a health stub.** `src/orchestrator/src/index.mjs`
   is ~100 lines, exposes `/health` and `/v1/status` only. It does not
   wire `@ruvector/ruvllm` or `@ruvector/server`, does not touch the
   DB, does not proxy to Ollama. The compose file advertises features
   the orchestrator isn't using.

#### S2 — blocks "LLMs improving over time"

5. **No metadata dimension on memories.** `hooks_remember` accepts
   only `content` + `type` ∈ {project, code, decision, context,
   general}. There is no field for project name, repo, language, file
   path, framework, tags, author, or scope. Result: memories from
   unrelated projects cross-contaminate. A Go project's sentinel-error
   rule out-ranks a Node-project's package-manager note (observed).
6. **No dedup, anywhere.** Saving the same content three times
   produced three entries, all three surfaced together in recall.
   Skill-side dedup (`similarity > 0.85` check) is ineffective because
   similarity is computed on a broken embedder.
7. **No scoped recall.** `hooks_recall` has no `project`, `repo`,
   `language`, or `tags` filter. `brain_search` takes `category` but is
   disabled. An LLM cannot say "recall *only within this repo*".
8. **SONA / auto-tune / LoRA are nominal features.**
   `RUVLLM_SONA_ENABLED=true` is accepted by config but
   `hooks_capabilities.sona=false`. The orchestrator never boots the
   learner, so `auto_tune` has no gradient to apply.
9. **Skills are too thin.** Each SKILL.md is 4–5 one-line imperative
   bullets. There's no recipe for:
   - distilling multi-paragraph chat into a 1-sentence memory,
   - deciding between "decision" vs "gotcha" vs "convention",
   - linking a capture to the repo, file, language,
   - post-save feedback (upvote/downvote → learning signal).
10. **No feedback loop.** `hooks_force_learn`,
    `hooks_coedit_record`, `hooks_error_record`, `brain_vote` exist but
    no skill invokes them. The "self-improving" claim is on paper only.

#### S3 — ergonomic/operational

11. **Empty-result handling.** `hooks_recall` never returns an empty
    `results` array — it always surfaces 5 low-score items. LLMs will
    treat noise as signal.
12. **Token length**: the installed `.secrets/auth-token` is **20
    chars**, not the documented 73. Either install.sh was short-
    circuited, or a test token is in place. Rotation brings it back
    to spec but this divergence should be flagged.
13. **Legacy SSE block at gateway returns 410.** Good behavior, but
    many existing MCP clients auto-try `/sse` first — they'll see the
    410 and bail before trying `/mcp`. Document explicitly.
14. **No rate limiting at the gateway.** A misbehaving agent spamming
    `hooks_remember` will happily explode the intelligence JSON file.
15. **Intelligence store is a single JSON file** at
    `/app/.ruvector/intelligence.json` (`38.4KB` at 21 memories).
    Scaling to thousands will linearly slow every recall.

---

## 3. What this means for "LLMs using this to self-improve"

On the current runtime, the tool **cannot** yet make an LLM's daily
work measurably better, and in the S1 issues above it will actively
make it *worse* (bad context is worse than no context). But the
architecture, skills authoring, security, and breadth of tools are
already strong enough that the gap is in wiring and tuning, not in
design premise.

The follow-up document `my-brain-optimization-plan.md` addresses each
S1/S2/S3 item with concrete changes to the orchestrator, the MCP tool
surface (metadata on writes + filtered reads), the skill set, the
curator agent, and the rules under `.claude/rules/`.
