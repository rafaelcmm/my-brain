# my-brain Technical Reference

This file is API and configuration reference for maintainers.

## REST endpoints

- `GET /health`: orchestrator liveness.
- `GET /ready`: orchestrator readiness (engine + db connection + ADR schemas + LLM runtime).
- `GET /v1/status`: orchestrator status snapshot.
- `GET /v1/capabilities`: engine/vector/sona/attention capability flags and degraded-mode reasons.
- `GET /v1/learning/stats`: session trajectory counters and current route confidence.
- `GET /metrics`: Prometheus-style counters for memory lifecycle and recall quality.
- `POST /v1/context/probe`: derives repo/project/language/framework context from the workspace.
  Accepts an optional JSON body with client-supplied hints that take precedence over server-side
  discovery (see [Context probe hints](#context-probe-hints) below).
- `POST /v1/memory`: writes validated memory envelope and metadata sidecar row.
- `POST /v1/memory/recall`: scoped metadata-filtered recall with minimum-score cutoff.
- `POST /v1/memory/vote`: stores up/down feedback for memory id.
- `POST /v1/memory/forget`: soft or hard forget by memory id.
- `POST /v1/memory/digest`: grouped summary across type/language/repo windows.
- `POST /v1/memory/backfill`: batch-bounded repair for rows missing `content_sha1`, `embedding`, or
  `embedding_vector`. Each call processes at most 1000 rows and returns `{ processed: N }`. Full
  repair of a large corpus requires looping until `processed === 0` — use
  `src/scripts/backfill-memory-metadata.sh` as the operator utility.
- `POST /v1/session/open`: opens tracked session with context payload.
- `POST /v1/session/close`: closes tracked session with success/quality labels.

More endpoints are added incrementally and documented here in same change set.

## Environment variables

Core variables currently consumed by runtime:

- `MYBRAIN_DB_URL`
- `MYBRAIN_LLM_URL`
- `MYBRAIN_LLM_MODEL`
- `MYBRAIN_EMBEDDING_MODEL`
- `MYBRAIN_EMBEDDING_DIM`
- `MYBRAIN_MIN_TOKEN_LENGTH`
- `MYBRAIN_RATE_LIMIT_PER_MIN`
- `MYBRAIN_MAX_REQUEST_BODY_BYTES`
- `MYBRAIN_PROMETHEUS_PORT`
- `MYBRAIN_INTERNAL_API_KEY`
- `MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH` — set `true` only when the orchestrator container user
  cannot read the token secret file (EACCES, non-root owner) and the Caddy gateway is the sole
  bearer-token enforcement point. Defaults to `false` (fail-closed).
- `RUVECTOR_HOST`
- `RUVECTOR_PORT`
- `RUVLLM_SONA_ENABLED`

## Context probe hints

`POST /v1/context/probe` accepts an optional JSON body. All fields are optional; omitting the body
causes the server to rely entirely on its own filesystem discovery.

| Field             | Type     | Purpose                                                                                  |
| ----------------- | -------- | ---------------------------------------------------------------------------------------- |
| `cwd`             | string   | Absolute path to the workspace root. Must exist on the server filesystem when supplied.  |
| `git_remote`      | string   | Git remote URL (e.g. `https://github.com/org/repo`). Used as the canonical `repo` value. |
| `repo_hint`       | string   | Fallback repo identifier when `git_remote` is absent.                                    |
| `repo_name`       | string   | Short repo name override (e.g. `my-brain`).                                              |
| `project_hint`    | string   | Project name override.                                                                   |
| `language_hint`   | string   | Primary language hint when auto-detection is insufficient.                               |
| `framework_hints` | string[] | Additional frameworks to merge with detected ones.                                       |
| `author`          | string   | Committer identity; falls back to local `git config user.name`.                          |

### `source` field in response

The `source` field on the returned context object describes how the context was derived:

| Value             | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| `client-hint`     | All primary fields came from the request body hints.            |
| `git`             | Derived from `git remote get-url origin` in the resolved `cwd`. |
| `package-json`    | Derived from `package.json` (name, dependencies).               |
| `cargo-toml`      | Derived from `Cargo.toml`.                                      |
| `pyproject`       | Derived from `pyproject.toml`.                                  |
| `server-fallback` | No hints and no detectable project files; defaults applied.     |

## Bridge contract

Bridge supports streamable HTTP MCP transport and acts as tool facade over upstream runtime tools.

## Recall semantics

- `include_expired`: controls entries hidden by `expires_at`.
- `include_forgotten`: controls entries hidden by soft forget (`forgotten_at`).
- `include_redacted`: controls entries hidden by redaction (`redacted_at`).
- Repo matching normalizes URL and repo short name (`repo_name`) selectors.

## Dedup and voting

- `POST /v1/memory` performs server-side dedup using scoped fingerprint + embedding similarity.
- Duplicate writes return existing `memory_id` and set `deduped: true`.
- Duplicate responses expose `dedup_reason` (`fingerprint` or `semantic`) so operators can separate exact-match vs near-duplicate collapse.
- `POST /v1/memory/vote` updates ranking bias; recall returns `semantic_score`, `vote_bias`, and final `score`.

## Metrics

Orchestrator `/metrics` includes:

Orchestrator non-public routes, including `/metrics`, require header
`x-mybrain-internal-key` matching `MYBRAIN_INTERNAL_API_KEY`.

- `mb_remember_total`
- `mb_recall_total{result="hit|miss"}`
- `mb_recall_latency_ms` (histogram — fixed buckets 5–5000 ms)
- `mb_dedup_hits_total`
- `mb_forget_total{mode="soft|hard"}`
- `mb_vote_total{direction="up|down"}`
- `mb_recall_latency_ms_bucket` / `mb_recall_latency_ms_sum` / `mb_recall_latency_ms_count`

Bridge metrics (default `:9090/metrics`) include:

- `mb_bridge_tool_calls_total{tool,status}`
- `mb_bridge_tools_list_total`
- `mb_bridge_tools_filtered_total{tool}`
- mirrored counters for `mb_remember_total`, `mb_recall_total`, `mb_dedup_hits_total`, `mb_forget_total`.
- `mb_bridge_recall_latency_ms` (histogram — fixed buckets 5–5000 ms)

Bridge metrics require header `x-mybrain-internal-key` with `MYBRAIN_INTERNAL_API_KEY` value.
