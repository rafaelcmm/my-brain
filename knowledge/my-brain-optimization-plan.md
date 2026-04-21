# my-brain — Optimization & Tuning Plan for Maximum LLM Self-Improvement

> Read after `my-brain-simulation-report.md`. That document enumerates the
> concrete defects observed on the running stack. This document prescribes
> how to close every one of them so the tool can act as a **silent,
> metadata-aware, self-tuning memory layer** that ships on a developer's
> machine and measurably improves their AI coding sessions.

The plan has six workstreams, ordered by leverage:

1. **Make the engine real** (unblock recall quality).
2. **Add metadata to every memory** (project, repo, language, path, tags).
3. **Metadata-aware MCP surface** (scoped writes + filtered reads).
4. **Upgrade the `.claude/` package** (skills, agent, new rules).
5. **Wire the feedback loop** (votes, coedits, error records → SONA).
6. **Operational guardrails** (rate limiting, dedup, empty-result honesty).

Everything is incremental — each workstream delivers value on its own.

---

## 1. Engine work — turn the stack from "responding" to "remembering"

The simulation's S1 defects (recall returns noise, `brain_*` 500s, SONA
off, 64-dim hash embedder, orchestrator is a health stub) all stem from
one root cause: **the orchestrator image never actually instantiates the
ruvLLM / ruvector-server runtime**. Fix that, and ~70% of the caveats
vanish.

### 1.1. Orchestrator: from stub to real runtime

Today `src/orchestrator/src/index.mjs` is a node `http` stub. Replace
with an initialization path that:

1. Connects to Postgres and asserts the `ruvector` extension is loaded
   at a pinned version.
2. Instantiates `@ruvector/ruvllm` `RuvLLM` with Ollama backend + local
   embedding model (e.g. `qwen3-embedding:0.6b`, 1024-dim, replacing
   the 64-dim hash fallback).
3. Mounts `@ruvector/server` as the REST surface under `/v1/*`.
4. Creates the three ADR-002 schemas (policy / session / witness) once.
5. Exposes `/health`, `/v1/status`, and a new `/v1/capabilities` that
   reflects what `hooks_capabilities` reports — so clients can
   detect degraded mode *before* they trust rankings.

Acceptance: after `docker compose up -d` a fresh run of
`hooks_capabilities` must return `engine=true, vectorDb=true, sona=true,
embeddingDim=1024` (or 384 if MiniLM chosen). No more `engineResult:
false` on recall hits.

### 1.2. Enable `brain_*` on this runtime

Either install `@ruvector/pi-brain` alongside `ruvector` in the
`my-brain-mcp` image, or replace every reference to `brain_*` in the
skill/agent files with the `hooks_*` equivalents that already work
(next section). The second path is faster; the first path gives the
collaborative/voting features back.

Recommended: **do both, sequenced**. Skills use `hooks_*` immediately;
curator upgrades to `brain_*` once `pi-brain` is in the image.

### 1.3. Kill hash-embeddings

Set `MYBRAIN_EMBEDDING_MODEL=qwen3-embedding:0.6b` in `.env.example`
and make the orchestrator route embedding calls to Ollama. Target
dims = 1024. Remove `MYBRAIN_EMBEDDING_DIM=384` hard-coding; read it
from the Ollama model instead. Validate with a recall test identical
to the one in the simulation report: "my-brain package manager" must
rank the pnpm memory **top-1 with ≥ 0.8** similarity.

---

## 2. Metadata on every memory — the single largest recall win

Currently `hooks_remember` accepts `{ content, type }`. That is why
memories from different projects and languages collide. The fix is to
require structured metadata on every write and make it queryable on
every read. This is implemented by adding a thin adapter layer in
**our** orchestrator so the upstream `ruvector` tools don't need to
change.

### 2.1. Canonical memory envelope

Every memory gets these fields, captured at write time and persisted
alongside the vector:

```jsonc
{
  "content":  "Short, context-free fact, 1–3 sentences.",
  "type":     "decision | fix | convention | gotcha | tradeoff | pattern | reference",
  "scope":    "repo | project | global",     // recall boundary default
  "metadata": {
    "repo":         "github.com/rafaelcmm/my-brain",
    "repo_name":    "my-brain",              // short form, used in filters
    "project":      "my-brain",              // may equal repo_name, or be broader
    "language":     "typescript",            // ISO-ish: typescript, go, python, rust, sql, shell, yaml, hcl…
    "frameworks":   ["nodejs", "caddy", "docker"],
    "path":         "src/orchestrator/src/index.mjs",  // optional, file-level
    "symbol":       "loadConfig",            // optional, function/class
    "tags":         ["auth", "bootstrap"],   // 2–5 kebab-case
    "source":       "conversation:2026-04-20",
    "author":       "rafaelmonteiro",
    "agent":        "workflow-orchestrator", // which agent captured it
    "created_at":   "2026-04-20T20:27:03Z",
    "expires_at":   null,                    // for time-boxed facts (e.g. deploy freezes)
    "confidence":   0.9,                     // writer's own confidence
    "visibility":   "private"                // private | team | public
  }
}
```

**Why these specific fields?**

- `repo` + `project` + `language` are the three axes that matter for
  cross-contamination. Almost every "wrong top hit" in the simulation
  would have been filtered out by any one of these.
- `path` + `symbol` let the capture skill attach memories to code
  locations; recall can then be keyed on "what do I know about *this*
  file".
- `frameworks` catches the cross-cutting case where a repo uses both
  React and Node — neither is the `language`, but both are semantic
  context.
- `expires_at` solves a category the research docs never addressed:
  time-boxed facts (e.g. "merge freeze until Thursday", "legacy auth
  endpoint to be removed 2026-05-01").
- `agent` closes the SONA feedback loop: when a memory is later
  upvoted/downvoted, the router learns which agent's captures pay off.

### 2.2. How to capture metadata *automatically*

Humans won't type this every time. Neither will LLMs, reliably. So we
capture metadata from the session context, not from the user:

| Field         | How it's derived                                              |
|---------------|---------------------------------------------------------------|
| `repo`, `repo_name` | `git config --get remote.origin.url` + `basename` |
| `project`      | value from `AGENTS.md` / `CLAUDE.md` frontmatter if present, else `repo_name` |
| `language`     | file extension of the file under discussion, or dominant repo language (`github-linguist`-style histogram computed by orchestrator once per session) |
| `frameworks`   | `package.json` deps, `go.mod`, `requirements.txt`, `Cargo.toml`, `compose.yaml` services, etc. — sniffed once per session |
| `path`, `symbol` | from the current `Edit`/`Read`/`Grep` tool call in the same turn |
| `author`       | `git config --get user.email` (local) |
| `agent`        | the sub-agent name if one is active, else "main" |
| `source`       | `conversation:<YYYY-MM-DD>` or `file:<path>` |

Implementation path:

- Add a thin **capture endpoint** on the orchestrator:
  `POST /v1/memory` that accepts the envelope above and calls the
  underlying `hooks_remember` internally while persisting metadata in
  a sidecar table (`my_brain_memory_metadata` keyed by memory id).
- Expose it as a new MCP tool in our bridge: **`mb_remember`**.
  Shipping our own tool is cleaner than trying to shim around
  `hooks_remember`'s limited schema.
- Ship a tiny **project-context probe** (`mb_context_probe`) that the
  session skill calls on open — it reads `git`, manifest files, and
  returns a cached `ProjectContext` every capture/recall can decorate
  with for free.

### 2.3. Mirror fields on recall

Add `mb_recall(query, top_k, scope?, repo?, language?, frameworks?, tags?, type?, include_expired=false)`.
Implementation filters the candidate set *before* the embedding
distance computation, so irrelevant-project memories never compete
for rank at all. Empty result sets are honored — no low-score padding.

Ship both the new tools and keep the legacy `hooks_remember` /
`hooks_recall` calls working for compatibility.

---

## 3. MCP surface additions

Concrete list of new tools our bridge should expose in front of the
`ruvector` ones:

| Tool              | Purpose                                          |
|-------------------|--------------------------------------------------|
| `mb_context_probe`| Return `ProjectContext` (repo, language, frameworks, freshness). |
| `mb_remember`     | Write with full metadata envelope (§2.1).        |
| `mb_recall`       | Scoped/filter-aware read (§2.3).                 |
| `mb_vote`         | Thumbs-up/down on a memory id → SONA feedback.   |
| `mb_forget`       | Soft-delete (sets `expires_at=now()`).           |
| `mb_session_open` | Wrapper over `hooks_trajectory_begin` with metadata. |
| `mb_session_close`| Wrapper over `hooks_trajectory_end` + curator ping. |
| `mb_digest`       | On-demand "what did I learn this week" summary across metadata axes. |

The bridge can be a small Node module added to `src/mcp-bridge/` that
sits in front of `npx ruvector mcp start` and rewrites/augments a
handful of tools. Everything else pass-through unchanged.

---

## 4. `.claude/` — skills, agent, and new rules

Currently `.claude/skills/*/SKILL.md` are 4–5 bullets of imperative
instructions and reference non-existent tools. Below are replacement
specs for each file. Trigger descriptions are kept *trigger-condition*
style (third person, signal phrases) per Anthropic's authoring
guidance.

### 4.1. Rewritten skills

All four skills gain:

- A `Preflight` step that calls `mb_context_probe` once per session
  (cached) and stashes `ProjectContext`.
- Explicit references to `mb_*` instead of the broken `brain_*`.
- A "degraded-mode check" — if `hooks_capabilities.engine === false`,
  fall back to *no context* instead of noisy context.

#### `my-brain-context/SKILL.md`

- Triggers: unchanged description.
- Body:
  1. Call `mb_context_probe` if not cached.
  2. Call `mb_recall` with `query = latest user message`, `top_k=8`,
     `scope=repo`, `repo=<context.repo>`, `language=<context.language>`.
  3. If degraded mode → skip step 2 entirely.
  4. Fold results with similarity > dynamic threshold (see §4.4).
  5. Silent. No narration.

#### `my-brain-capture/SKILL.md`

- Triggers: durable knowledge (decision / fix / convention / gotcha).
- Body:
  1. Distill to 1–3 sentences, context-free.
  2. Classify `type` using the enum in §2.1.
  3. Decorate via `ProjectContext` (repo, project, language, frameworks).
  4. Attach `path`/`symbol` from the most recent `Edit`/`Read` tool call.
  5. `mb_recall(query=content, top_k=3, scope=repo)` dedup pass — skip
     save if any hit > 0.85 after true-embedding (guard still applies).
  6. `mb_remember(envelope)`.
  7. Silent unless user asks.

#### `my-brain-recall/SKILL.md`

- Triggers: explicit "what did we decide" class questions.
- Body: `mb_recall(top_k=10, scope=repo, include_expired=false)`,
  group by `metadata.type` and `metadata.tags`, present concise list.
- If result set empty → say so, do not invent, do not pad with low-score
  noise.

#### `my-brain-session/SKILL.md`

- Triggers: unchanged description.
- Body:
  1. `mb_session_open(context=ProjectContext, agent=<main|subagent>)`.
  2. Stash trajectory id.
  3. `mb_session_close(success, quality)` on end signal.
- Remove dead references to `session_start`/`session_end`.

### 4.2. New skill: `my-brain-feedback`

Silent post-answer skill. Triggers when the user confirms/rejects
earlier advice ("that worked", "no that broke X", "actually that was
wrong"). Body:

1. Find the memory id(s) the recall skill surfaced earlier in the
   conversation.
2. Call `mb_vote(id, up|down, reason?)`.
3. On strong negative feedback, also call `hooks_error_record` with
   `prev_output`, `corrected_output`, `file`, so the learner sees the
   delta.

This is the missing piece for "self-improvement": every interaction
that produces a satisfied/unsatisfied user is now a SONA signal.

### 4.3. Curator agent (`.claude/agents/my-brain-curator.md`)

Rewrite to use the tools that actually exist on this stack:

- `brain_search` → `mb_recall` (and once pi-brain is installed, `brain_search`).
- `brain_agi_status` → `hooks_capabilities` + `hooks_stats`.
- `brain_sona_stats` → `hooks_learning_stats` (graceful fallback when
  LearningEngine is off).

Add three new checklist items:

- **Metadata hygiene**: memories with no `repo` / `language` → attempt
  re-derivation from `path` / `content`, else tag as `global`.
- **Expiration sweep**: delete/mark as archived memories whose
  `expires_at < now()`.
- **Cross-project leakage check**: sample 20 recent memories; for each,
  run `mb_recall(content, top_k=5, scope=global)` and flag pairs where
  a `repo=A` memory has the same content as a `repo=B` memory — usually
  a sign that an originally-global fact was over-scoped.

### 4.4. New rule: `.claude/rules/memory-hygiene.md`

A shared rule that any code-change workflow can `import`:

- What counts as durable → calls the my-brain-capture skill.
- How the dynamic similarity threshold is computed:
  `threshold = 0.6` when `engine=true`, `threshold = 0.85` when
  `engine=false` (because hash scores are compressed in a smaller range
  and false-positives dominate).
- How `scope` should be chosen:
  - `repo` for anything that references a specific file, function, or
    build-system choice.
  - `project` for product decisions spanning multiple repos.
  - `global` only for language/framework-level gotchas that have no
    repo dependency ("Python GIL is real", etc.).
- When **not** to capture: same list as the existing CLAUDE.md rule in
  `~/.claude/CLAUDE.md` on "What NOT to save in memory".

### 4.5. New rule: `.claude/rules/memory-retrieval.md`

Codifies read behavior:

- Prefer metadata filtering over raw search. Always pass `repo` and
  `language` unless the user explicitly asks "what have I learned
  anywhere about X".
- Honor empty result sets — never pad.
- If `engine=false`, the entire my-brain surface is advisory only,
  never authoritative. Memories must be labeled "(unverified fallback)"
  when surfaced to the user.

### 4.6. Rule-router hook

Extend `~/.claude/AGENTS.md` so the code-change rule automatically
loads `memory-hygiene` and `memory-retrieval`. The `CLAUDE.md` overlay
already declares the router — we just add these two rule paths.

---

## 5. Closing the learning loop

Today the "self-improvement" story is mostly aspirational — no tool
call ever feeds SONA with a labelled outcome. Four concrete changes fix
that:

1. **Trajectory wrap every assistant turn.** The session skill already
   opens/closes per session. Add an inner-loop: a pre/post around
   *every* non-trivial answer. On the post, record `quality` from one
   of three signals:
   - explicit user feedback ("good", "that works", thumbs),
   - test/build outcome if the turn ran a test,
   - absence of follow-up correction within N turns (weak positive).
2. **Route on real data.** Surface `hooks_route_enhanced` in a
   `my-brain-routing` skill so agent selection is learned from
   historical trajectory outcomes, not the "default mapping" the
   current `hooks_route` returns at 0.5 confidence.
3. **Coedit + error records.** After any `Edit` tool call the user
   accepts without further modification, call `hooks_coedit_record`
   (positive). After any code the user immediately rewrites, call
   `hooks_error_record` (negative). Both already exist in the tool
   list; nothing blocks wiring them up.
4. **Weekly digest → capture.** Have the curator run `mb_digest`
   weekly and persist the top-N most-recalled memories as "elevated"
   (a new `pattern` type), so they surface faster on subsequent
   sessions.

---

## 6. Operational guardrails

| Issue observed                              | Fix                                                |
|---------------------------------------------|----------------------------------------------------|
| No rate limiting on gateway                 | Add Caddy `rate_limit` module; 60 req/min per token per path class (`/mcp/*`, `/v1/memory/*`). |
| Intelligence store = single JSON file       | Move durable writes into Postgres (already running); JSON becomes an in-memory cache only. |
| Empty-result recall pads with noise         | Implement minimum-score cutoff in `mb_recall` derived from degraded/healthy mode. |
| Skills/agent reference non-existent tools   | Rewrite per §4. Add CI step that validates every `mcp__my-brain__*` identifier in `.claude/` appears in a fresh `tools/list` dump. |
| Bearer token in this install is 20 chars    | `install.sh` must fail-close if the generated token is shorter than the spec; rotation is mandatory before first real use. |
| `hooks_init` has side effects on container  | Document that it is a write tool, not a probe; skills must never call it. |
| Legacy `/sse` returns 410 — clients bail    | Keep the 410 but add a `Link: </mcp>; rel="successor"` header so smart clients can hop automatically. |

---

## 7. Metadata-first MCP tool surface — final reference

What a mature `my-brain` MCP tool list looks like after this plan.
Legacy tools keep working; LLMs default to `mb_*` because the skills
point there.

```
mb_context_probe(refresh=false)
mb_remember(content, type, scope, metadata)
mb_recall(query, top_k=8, scope?, repo?, project?, language?,
          frameworks?, tags?, type?, include_expired=false,
          min_score?)
mb_vote(id, direction, reason?)
mb_forget(id, mode="soft|hard")
mb_digest(since="1w", group_by=["type","language","repo"])
mb_session_open(agent, context=ProjectContext)
mb_session_close(success, quality?, reason?)
```

Plus the full `hooks_*` surface for advanced ops, and `brain_*` once
`@ruvector/pi-brain` is in the image.

---

## 8. Sequencing — what to do in what order

This is the order that yields usable improvements fastest while not
breaking the existing stack.

### Phase 0 — Truth-in-advertising (half a day)

- Rewrite all four skills + curator to reference only tools that
  currently exist (`hooks_*`). Keep behavior degraded-mode honest.
- Add the new memory-hygiene + memory-retrieval rules.
- Add the CI check that validates every tool id referenced by a skill
  appears in a live `tools/list`.

### Phase 1 — Real engine (2–3 days)

- Replace the orchestrator stub with the real `@ruvector/ruvllm` +
  `@ruvector/server` wiring.
- Pull an embedding model; make `hooks_capabilities` show engine=true.
- Re-run the simulation's test queries; confirm pnpm-query returns
  pnpm-memory top-1.

### Phase 2 — Metadata-aware surface (2–3 days)

- Add `ProjectContext` probe, sidecar metadata table, `mb_*` bridge.
- Rewrite skills to use the new tools with scoped filtering.
- Add dedup via true embedding similarity.

### Phase 3 — Feedback loop (2 days)

- Ship `my-brain-feedback` skill, wire coedit/error records, extend
  session skill to wrap per-turn trajectories.
- Enable `hooks_route_enhanced`, retire the default-mapping route.

### Phase 4 — `@ruvector/pi-brain` re-enable (1 day)

- Install in the MCP bridge image; re-point curator at `brain_*`.
- Expose `brain_vote` via `mb_vote` for multi-agent voting.

### Phase 5 — Ops + polish (1–2 days)

- Caddy rate limiting.
- Token-length validation in `install.sh`.
- Weekly digest cron via the curator agent.
- Documentation pass across README + `docs/`.

Total: ~10 working days to go from "impressive-looking stack with
broken recall" to "silent, metadata-aware, self-tuning local memory
layer that measurably improves developer sessions".

---

## 9. Success metrics

How we know this worked. Collect these monthly via `mb_digest`:

| Metric                                       | Target                 |
|----------------------------------------------|------------------------|
| Top-1 recall accuracy on a canned test set of 20 Q/A pairs | ≥ 0.85 |
| Fraction of recalls that LLM actually used in its answer (user upvote proxy) | ≥ 0.50 |
| Cross-project contamination (top-5 hits from wrong repo)   | ≤ 5%  |
| Duplicate-memory ratio                        | ≤ 3%  |
| `hooks_capabilities.engine == true` on all install boots  | 100% |
| Mean `mb_recall` p95 latency                  | ≤ 150 ms |
| Number of coedit-positive records per week    | > 20 |
| SONA `confidence` on routing decisions        | > 0.75 |

When all eight move in the right direction for three consecutive
weeks, the self-improvement claim is no longer aspirational — it's
operational.
