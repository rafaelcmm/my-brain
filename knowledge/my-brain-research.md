# Deep Research (v2): Self-Hosting `my-brain` — a ruvLLM-powered memory & orchestration layer for Copilot, Cursor, Claude Code

> **What this is.** A self-hosted, Docker-Compose-based "external brain" for any LLM client that speaks MCP. Under the hood it uses ruvLLM + RuVector. On the outside it's branded `my-brain` — every service name, env var, skill, and agent lives under that namespace. Everything is configurable via `.env`, and the skills/agents are written to be *model-triggered*, not user-triggered.

---

## 0. Architectural decisions (and why)

Five questions shaped this design. Answering them up front explains everything downstream.

### 0.1. Can the calling LLM (Claude Code / Copilot / Cursor) act as the backend?

**No — and it's a hard limit of MCP itself.** The Model Context Protocol is strictly client → server: the client (the LLM's host) calls `tools/call` on the server, the server returns a result. There is **no back-channel** for the server to invoke the client's LLM mid-request. So `my-brain` cannot "borrow" Claude Code's Claude model — if a tool needs token generation, `my-brain` has to generate it itself, locally.

**However** — and this is the important nuance — most of the useful tools ruvLLM exposes **do not need token generation at all**:

| Tool family | Needs LLM generation? | What it does |
|---|---|---|
| `memory_remember`, `memory_recall`, `brain_search`, `brain_share` | **No** | Pure HNSW vector ops on RuVector |
| `hooks_rag_context`, `hooks_route`, `hooks_route_enhanced` | **No** | Embedding + routing, no text synthesis |
| `hooks_ast_analyze`, `hooks_diff_classify`, `hooks_security_scan` | **No** | Deterministic Rust/WASM |
| `hooks_graph_mincut`, `hooks_graph_cluster` | **No** | Graph algorithms |
| `brain_explore`, `brain_agi_status` summaries | **Yes** (optional) | Natural-language summarization of memory graphs |
| SONA self-learning via `record_feedback` + `auto_tune` | **No** | Gradient updates on the router |

So there are **two supported modes**, selected by `MYBRAIN_MODE` in `.env`:

- **`memory`** (default) — no local LLM. Compose has 3 services: DB + orchestrator + MCP gateway. `brain_explore` and other synthesis tools return raw JSON; the *caller's* LLM (Claude, GPT, etc.) does any natural-language rendering. ~500 MB RAM, no GPU needed.
- **`full`** — boots a local Ollama + Qwen3.5 model as a 4th service for background synthesis, re-ranking, and LoRA training. ~3–4 GB RAM extra.

Both are Compose profiles, so you just flip a flag.

### 0.2. Wouldn't a dedicated vector DB (Qdrant, Milvus) scale better than Postgres?

**No — `ruvnet/ruvector-postgres` is the correct call, even for future scale.** Three reasons:

1. **RuVector's self-learning only exists in the Postgres extension.** The 77+ SQL functions (`ruvector_record_feedback`, `ruvector_auto_tune`, `ruvector_register_agent`, `ruvector_cypher`, `ruvector_gcn_forward`, `ruvector_poincare_distance`) are the *whole point* — they're what makes this "ruvLLM-powered" and not "just another vector store with an MCP shim". Switching to Qdrant means re-implementing GNN, ReasoningBank, Cypher graph queries, and hyperbolic embeddings yourself. That's months of work.
2. **RuVector already scales horizontally via the same image.** Upstream ships Raft consensus, multi-master replication, and automatic sharding (`docker-compose up -d ruvector-cluster`). Published benchmarks: 61µs p50 latency, 200 MB per 1M vectors with 2–32× adaptive compression — tighter than Qdrant (~1ms, 1.5 GB) or Milvus (~5ms, 1 GB) on their published numbers. The RuVector team designed this to avoid *"self-hosted complexity (Milvus, Qdrant) — heavy infrastructure, Docker orchestration, operational overhead"* (their words).
3. **Postgres is a scaling *advantage*, not a liability.** WAL-based replication, PITR backups, PgBouncer connection pooling, standard monitoring, every DBA knows it. A dedicated vector DB is *more* ops work at scale, not less.

Scaling path when you need it: single-node → `ruvector-cluster` (3-node Raft) → sharded clusters — all on the same image, same SQL, same MCP tools.

### 0.3. Everything via `.env`

Agreed. The `docker-compose.yml` below is ~100% variable substitution, shipped with a fully-commented `.env.example`.

### 0.4. Namespace under `my-brain`

Every service, volume, network, env-var prefix, skill, and agent uses `my-brain` / `MYBRAIN_`. `ruvllm` / `ruvector` appear only inside implementation files (image names, npm deps) that you'd never look at during normal use.

### 0.5. Model-invoked skills, not user-invoked

Agent Skills have two invocation modes:
- **User-invocable** (`/skill-name` slash command) — user types it.
- **Model-invoked** — Claude reads the YAML `description` at session start and autonomously triggers the skill based on conversation signals.

For an autonomous memory layer you want **only** model-invoked. The mechanism:
- Write `description` as a *trigger condition*, third person, with concrete signal phrases.
- Do **not** set `user-invocable: true`.
- Do **not** use imperative language ("Use this to..."). Claude is deciding autonomously, so describe *when it's relevant*, not *what to do with it*.

Anthropic's own docs emphasize: *"The description field enables Skill discovery and should include both what the Skill does and when to use it. Always write in third person."* Examples later in the doc.

---

## 1. What's under the hood (reference only)

`my-brain` is branding over three upstream projects:

| Component | Upstream | Role |
|---|---|---|
| Memory DB | `ruvnet/ruvector-postgres` | PostgreSQL + `ruvector` extension: 77+ SQL funcs, HNSW, Cypher graphs, GNN, ReasoningBank |
| Orchestrator | `@ruvector/ruvllm` + `@ruvector/server` (npm) | SONA routing, MicroLoRA, EWC++, chat templates, HNSW router, Axum REST |
| MCP server | `npx ruvector mcp start` (from the `ruvector` npm) | ~103 tools over stdio — bridged to HTTP with `mcp-proxy` |

**Canonical sources** (bookmark these):

- `github.com/ruvnet/ruvector` — monorepo
- `github.com/ruvnet/ruvector/tree/main/examples/ruvLLM` — ruvLLM reference implementation
- `github.com/ruvnet/ruvector/blob/main/docs/adr/ADR-002-ruvllm-integration.md` — how ruvLLM + RuVector share memory (policy / session / witness roles)
- `hub.docker.com/r/ruvnet/ruvector-postgres` — DB image
- `npmjs.com/package/@ruvector/server` — REST API contract
- `npmjs.com/package/@ruvector/ruvllm` — orchestration API contract
- `modelcontextprotocol.io/specification/2025-03-26/basic/transports` — `/mcp` Streamable HTTP spec
- `github.com/sparfenyuk/mcp-proxy` — stdio ↔ Streamable HTTP bridge
- `platform.claude.com/docs/en/agents-and-tools/agent-skills/overview` — Agent Skills spec
- `platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices` — trigger-oriented description authoring
- `ollama.com/library/qwen3.5/tags` — confirms `qwen3.5:0.8b` (1.0 GB, 256K ctx) and `qwen3.5:2b` (2.7 GB, 256K ctx), both with `tools` + `thinking` support, updated recently

---

## 2. Directory layout

```
my-brain/
├── docker-compose.yml
├── .env.example
├── .env                       # gitignored, user-created
├── orchestrator/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       └── index.mjs
├── db/
│   └── init/
│       └── 01-enable-extension.sql
├── .claude/                   # picked up by Claude Code automatically
│   ├── skills/
│   │   ├── my-brain-context/
│   │   │   └── SKILL.md
│   │   ├── my-brain-recall/
│   │   │   └── SKILL.md
│   │   ├── my-brain-capture/
│   │   │   └── SKILL.md
│   │   └── my-brain-session/
│   │       └── SKILL.md
│   └── agents/
│       └── my-brain-curator.md
├── .mcp.json                  # MCP client config (Claude Code, Cursor, VS Code)
└── README.md
```

---

## 3. `.env.example` — every knob exposed

```bash
# ─────────────────────────────────────────────────────────────────────────────
# my-brain environment configuration
# Copy to `.env` and adjust. All values are read by docker-compose.yml.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Mode ────────────────────────────────────────────────────────────────────
# memory → no local LLM, smallest footprint (DB + orchestrator + MCP gateway)
# full   → adds local Ollama + Qwen3.5 for synthesis/re-ranking/LoRA training
MYBRAIN_MODE=memory

# ─── Project identity ────────────────────────────────────────────────────────
MYBRAIN_PROJECT_NAME=my-brain
MYBRAIN_NETWORK_NAME=my-brain-net

# ─── Exposed ports ───────────────────────────────────────────────────────────
MYBRAIN_MCP_PORT=3333            # Streamable HTTP MCP endpoint → /mcp
MYBRAIN_REST_PORT=8080           # ruvector-server REST API
MYBRAIN_DB_PORT=5432             # Postgres (only needed for debugging)
MYBRAIN_LLM_PORT=11434           # Ollama (only used if MYBRAIN_MODE=full)

# ─── Bind host (0.0.0.0 for LAN, 127.0.0.1 for local-only) ──────────────────
MYBRAIN_BIND_HOST=127.0.0.1

# ─── Database ────────────────────────────────────────────────────────────────
MYBRAIN_DB_IMAGE=ruvnet/ruvector-postgres:latest
MYBRAIN_DB_USER=mybrain
MYBRAIN_DB_PASSWORD=change-me-in-real-life
MYBRAIN_DB_NAME=mybrain_db
MYBRAIN_DB_VOLUME=my-brain-db-data

# ─── Orchestrator (ruvLLM + ruvector-server) ────────────────────────────────
MYBRAIN_ORCHESTRATOR_IMAGE_TAG=my-brain/orchestrator:local
MYBRAIN_ORCHESTRATOR_VOLUME_MODELS=my-brain-models
MYBRAIN_ORCHESTRATOR_VOLUME_STATE=my-brain-state    # SONA patterns, EWC++ Fisher, trajectories

# ruvLLM runtime knobs (map directly to RuvLLMConfig in @ruvector/ruvllm)
MYBRAIN_SONA_ENABLED=true                # enable SONA self-learning
MYBRAIN_FLASH_ATTENTION=true             # enable Flash Attention 2
MYBRAIN_MAX_TOKENS=512
MYBRAIN_TEMPERATURE=0.7
MYBRAIN_TOP_P=0.9

# ─── Memory / routing behaviour ─────────────────────────────────────────────
MYBRAIN_HNSW_M=16                        # HNSW graph connectivity
MYBRAIN_HNSW_EF_CONSTRUCTION=64
MYBRAIN_HNSW_EF_SEARCH=100
MYBRAIN_EMBEDDING_DIM=384                # 384 for ONNX MiniLM; 1024 for qwen3-embedding:0.6b; 1536 for OpenAI
MYBRAIN_AUTO_TUNE_ENABLED=true           # let SONA adjust HNSW params from feedback
MYBRAIN_LEARNING_ENABLED=true            # enable ReasoningBank

# ─── CORS / security (for /mcp and REST) ────────────────────────────────────
MYBRAIN_CORS_ORIGINS=*                   # tighten in production
MYBRAIN_ALLOWED_MCP_ORIGINS=http://localhost,http://127.0.0.1

# ─── Local LLM backend (only used when MYBRAIN_MODE=full) ───────────────────
MYBRAIN_LLM_IMAGE=ollama/ollama:latest
MYBRAIN_LLM_VOLUME=my-brain-ollama
MYBRAIN_LLM_MODEL=qwen3.5:0.8b           # 1.0 GB, 256K ctx, tools+thinking+vision
# Alternatives (all current on Ollama):
#   qwen3.5:0.8b  → 1.0 GB (smallest, recommended default)
#   qwen3.5:2b    → 2.7 GB (better quality, worth it if you have the RAM)
#   qwen3.5:4b    → 4.0 GB (strong quality, needs ~6 GB RAM)
#   qwen3-coder:30b → 19 GB (only if biased toward heavy code synthesis + GPU)

# Optional separate embedding model on the same Ollama. If set, the orchestrator
# calls this for embeddings instead of the bundled ONNX MiniLM.
MYBRAIN_EMBEDDING_MODEL=                 # e.g. qwen3-embedding:0.6b (639 MB)

# Enable NVIDIA GPU. Leave empty for CPU-only.
MYBRAIN_LLM_GPU_COUNT=

# ─── Logging ────────────────────────────────────────────────────────────────
MYBRAIN_LOG_LEVEL=info                   # debug | info | warn | error

# ─── Telemetry (optional, off by default) ───────────────────────────────────
MYBRAIN_PROMETHEUS_ENABLED=false
MYBRAIN_PROMETHEUS_PORT=9090
```

---

## 4. `docker-compose.yml`

Uses Compose **profiles** so the LLM backend is optional. Every value comes from `.env`.

```yaml
# docker-compose.yml
name: ${MYBRAIN_PROJECT_NAME:-my-brain}

networks:
  default:
    name: ${MYBRAIN_NETWORK_NAME:-my-brain-net}

volumes:
  db-data:
    name: ${MYBRAIN_DB_VOLUME:-my-brain-db-data}
  models:
    name: ${MYBRAIN_ORCHESTRATOR_VOLUME_MODELS:-my-brain-models}
  state:
    name: ${MYBRAIN_ORCHESTRATOR_VOLUME_STATE:-my-brain-state}
  ollama:
    name: ${MYBRAIN_LLM_VOLUME:-my-brain-ollama}

services:

  # ─── Memory store ────────────────────────────────────────────────────────
  my-brain-db:
    image: ${MYBRAIN_DB_IMAGE:-ruvnet/ruvector-postgres:latest}
    container_name: my-brain-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${MYBRAIN_DB_USER:-mybrain}
      POSTGRES_PASSWORD: ${MYBRAIN_DB_PASSWORD:?set MYBRAIN_DB_PASSWORD in .env}
      POSTGRES_DB: ${MYBRAIN_DB_NAME:-mybrain_db}
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    ports:
      - "${MYBRAIN_BIND_HOST:-127.0.0.1}:${MYBRAIN_DB_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${MYBRAIN_DB_USER:-mybrain} -d ${MYBRAIN_DB_NAME:-mybrain_db}"]
      interval: 5s
      timeout: 5s
      retries: 12

  # ─── Local LLM backend (only when MYBRAIN_MODE=full) ────────────────────
  my-brain-llm:
    image: ${MYBRAIN_LLM_IMAGE:-ollama/ollama:latest}
    container_name: my-brain-llm
    restart: unless-stopped
    profiles: ["full"]
    environment:
      OLLAMA_HOST: 0.0.0.0
    volumes:
      - ollama:/root/.ollama
    ports:
      - "${MYBRAIN_BIND_HOST:-127.0.0.1}:${MYBRAIN_LLM_PORT:-11434}:11434"
    # GPU block only kicks in if MYBRAIN_LLM_GPU_COUNT is set; otherwise CPU.
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: ${MYBRAIN_LLM_GPU_COUNT:-0}
              capabilities: [gpu]

  # One-shot init container that pulls the configured models on first boot.
  my-brain-llm-init:
    image: ${MYBRAIN_LLM_IMAGE:-ollama/ollama:latest}
    container_name: my-brain-llm-init
    profiles: ["full"]
    depends_on:
      my-brain-llm:
        condition: service_started
    environment:
      OLLAMA_HOST: http://my-brain-llm:11434
    entrypoint: >
      sh -c "
        echo 'Pulling chat model: ${MYBRAIN_LLM_MODEL:-qwen3.5:0.8b}' &&
        ollama pull ${MYBRAIN_LLM_MODEL:-qwen3.5:0.8b} &&
        if [ -n \"${MYBRAIN_EMBEDDING_MODEL:-}\" ]; then
          echo 'Pulling embedding model: ${MYBRAIN_EMBEDDING_MODEL}' &&
          ollama pull ${MYBRAIN_EMBEDDING_MODEL};
        fi &&
        echo 'Models ready.'
      "
    restart: "no"

  # ─── Orchestrator (ruvLLM + ruvector-server REST) ───────────────────────
  my-brain-orchestrator:
    build:
      context: ./orchestrator
    image: ${MYBRAIN_ORCHESTRATOR_IMAGE_TAG:-my-brain/orchestrator:local}
    container_name: my-brain-orchestrator
    restart: unless-stopped
    depends_on:
      my-brain-db:
        condition: service_healthy
    environment:
      MYBRAIN_MODE: ${MYBRAIN_MODE:-memory}
      MYBRAIN_LOG_LEVEL: ${MYBRAIN_LOG_LEVEL:-info}

      # REST server (ruvector-server) binding
      RUVECTOR_HOST: 0.0.0.0
      RUVECTOR_PORT: "8080"
      RUVECTOR_CORS_ORIGINS: ${MYBRAIN_CORS_ORIGINS:-*}
      RUVECTOR_ENABLE_COMPRESSION: "true"

      # DB connection
      MYBRAIN_DB_URL: postgres://${MYBRAIN_DB_USER:-mybrain}:${MYBRAIN_DB_PASSWORD}@my-brain-db:5432/${MYBRAIN_DB_NAME:-mybrain_db}

      # LLM backend (ignored in memory mode)
      MYBRAIN_LLM_URL: http://my-brain-llm:11434
      MYBRAIN_LLM_MODEL: ${MYBRAIN_LLM_MODEL:-qwen3.5:0.8b}
      MYBRAIN_EMBEDDING_MODEL: ${MYBRAIN_EMBEDDING_MODEL:-}

      # ruvLLM config
      RUVLLM_SONA_ENABLED: ${MYBRAIN_SONA_ENABLED:-true}
      RUVLLM_FLASH_ATTENTION: ${MYBRAIN_FLASH_ATTENTION:-true}
      RUVLLM_MAX_TOKENS: ${MYBRAIN_MAX_TOKENS:-512}
      RUVLLM_TEMPERATURE: ${MYBRAIN_TEMPERATURE:-0.7}
      RUVLLM_TOP_P: ${MYBRAIN_TOP_P:-0.9}

      # HNSW
      MYBRAIN_HNSW_M: ${MYBRAIN_HNSW_M:-16}
      MYBRAIN_HNSW_EF_CONSTRUCTION: ${MYBRAIN_HNSW_EF_CONSTRUCTION:-64}
      MYBRAIN_HNSW_EF_SEARCH: ${MYBRAIN_HNSW_EF_SEARCH:-100}
      MYBRAIN_EMBEDDING_DIM: ${MYBRAIN_EMBEDDING_DIM:-384}

      # Learning
      MYBRAIN_AUTO_TUNE_ENABLED: ${MYBRAIN_AUTO_TUNE_ENABLED:-true}
      MYBRAIN_LEARNING_ENABLED: ${MYBRAIN_LEARNING_ENABLED:-true}
    volumes:
      - models:/app/models
      - state:/app/.mybrain
    ports:
      - "${MYBRAIN_BIND_HOST:-127.0.0.1}:${MYBRAIN_REST_PORT:-8080}:8080"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8080/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10

  # ─── MCP gateway: exposes the stack as `/mcp` over Streamable HTTP ──────
  my-brain-mcp:
    image: ghcr.io/sparfenyuk/mcp-proxy:latest
    container_name: my-brain-mcp
    restart: unless-stopped
    depends_on:
      my-brain-orchestrator:
        condition: service_healthy
    environment:
      MYBRAIN_REST_URL: http://my-brain-orchestrator:8080
      MYBRAIN_DB_URL: postgres://${MYBRAIN_DB_USER:-mybrain}:${MYBRAIN_DB_PASSWORD}@my-brain-db:5432/${MYBRAIN_DB_NAME:-mybrain_db}
      MYBRAIN_ALLOWED_ORIGINS: ${MYBRAIN_ALLOWED_MCP_ORIGINS:-http://localhost,http://127.0.0.1}
    # mcp-proxy bridges stdio MCP servers to Streamable HTTP on a single endpoint.
    # Endpoint path defaults to /mcp.
    command: >
      --host 0.0.0.0
      --port 3333
      --pass-environment
      --allow-origin ${MYBRAIN_ALLOWED_MCP_ORIGINS:-http://localhost,http://127.0.0.1}
      --
      npx -y ruvector mcp start
    ports:
      - "${MYBRAIN_BIND_HOST:-127.0.0.1}:${MYBRAIN_MCP_PORT:-3333}:3333"
```

**Usage patterns:**

```bash
# Memory-only mode (default, no local LLM)
docker compose up -d

# Full mode with local Qwen3.5
MYBRAIN_MODE=full docker compose --profile full up -d

# Upgrade the model without rebuilding anything else
MYBRAIN_LLM_MODEL=qwen3.5:2b docker compose --profile full up -d my-brain-llm-init
```

---

## 5. `db/init/01-enable-extension.sql`

```sql
-- Runs once, on the first startup of my-brain-db.
-- The ruvector extension requires an explicit version string.

CREATE EXTENSION IF NOT EXISTS ruvector VERSION '0.1.0';

-- Sanity check (visible in container logs):
DO $$
BEGIN
    RAISE NOTICE 'ruvector version: %', ruvector_version();
END $$;

-- Enable SONA learning by default; orchestrator can toggle at runtime.
SELECT ruvector_enable_learning(true);
```

The orchestrator creates its own tables on first connect (the three canonical namespaces from ADR-002 — policy store, session state index, witness log — all sharing the same HNSW substrate). The init script above is just the safety check that the extension loaded.

---

## 6. `orchestrator/Dockerfile` + `src/index.mjs`

```dockerfile
# orchestrator/Dockerfile
FROM node:20-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["node", "src/index.mjs"]
```

`orchestrator/package.json`:

```json
{
  "name": "my-brain-orchestrator",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@ruvector/ruvllm": "^2.5.0",
    "@ruvector/server": "^0.1.0",
    "ruvector": "^0.2.22"
  }
}
```

`orchestrator/src/index.mjs` — shape only; real APIs are documented at `npmjs.com/@ruvector/ruvllm` and `npmjs.com/@ruvector/server`:

```js
import { RuvLLM } from '@ruvector/ruvllm';

const MODE = process.env.MYBRAIN_MODE ?? 'memory';

const llm = new RuvLLM({
  sonaEnabled: process.env.RUVLLM_SONA_ENABLED === 'true',
  flashAttention: process.env.RUVLLM_FLASH_ATTENTION === 'true',
  maxTokens: Number(process.env.RUVLLM_MAX_TOKENS ?? 512),
  temperature: Number(process.env.RUVLLM_TEMPERATURE ?? 0.7),
  topP: Number(process.env.RUVLLM_TOP_P ?? 0.9),
  // In full mode: point at the local Ollama backend.
  // In memory mode: synthesis tools return raw JSON; the caller's LLM renders NL.
  ...(MODE === 'full' && {
    backend: {
      type: 'ollama',
      url: process.env.MYBRAIN_LLM_URL,
      model: process.env.MYBRAIN_LLM_MODEL,
      embeddingModel: process.env.MYBRAIN_EMBEDDING_MODEL || undefined,
    },
  }),
});

// @ruvector/server exposes the REST surface documented upstream:
//   GET  /health
//   POST /collections
//   GET  /collections
//   GET  /collections/{name}
//   DELETE /collections/{name}
//   POST /collections/{name}/vectors
//   GET  /collections/{name}/vectors/{id}
//   DELETE /collections/{name}/vectors/{id}
//   POST /collections/{name}/search
//   POST /collections/{name}/search/batch

// ...wire server + ruvLLM together here...
```

---

## 7. The `/mcp` endpoint — what the caller's LLM sees

After `docker compose up`, any MCP-capable client talks to a single endpoint:

```
POST http://localhost:3333/mcp
Content-Type: application/json
Accept: application/json, text/event-stream
Mcp-Session-Id: <assigned on initialize>
```

Tools exposed by `npx ruvector mcp start` — conceptually "my-brain tools" to the user — fall into five families. The important ones for the memory use case:

| Tool (ruvector name) | What it does | When Claude autonomously calls it |
|---|---|---|
| `hooks_rag_context` | Fetch top-K semantically similar snippets | Before answering any non-trivial question |
| `brain_search` | Pure vector search across shared brain | When user references past work |
| `brain_share` | Persist knowledge | After solving something worth remembering |
| `hooks_route` | Suggest sub-agent for a task | When task routing is ambiguous |
| `hooks_ast_analyze` | Structural analysis of code | Before editing unknown code |
| `hooks_diff_classify` | Risk-classify a diff | Before committing/reviewing |
| `hooks_security_scan` | Scan for vulnerabilities | Before deploying |
| `brain_sona_stats` | Report what SONA has learned | Diagnostics |

The full list is ~103 tools. The skills below tell Claude which to prefer and when — autonomously.

---

## 8. Skills — **model-invoked, autonomous, silent**

All four skills share two authoring rules, lifted directly from Anthropic's best-practices guide:

1. **Description written as a *trigger condition*, third person, signal-phrase-rich.** A description like *"Use this to remember things"* fails — it's imperative and vague. A description like *"Automatically invoked when the conversation references prior decisions, prior sessions, or work that may already exist in long-term project memory — signals include phrases like 'we decided', 'last time', 'earlier you', or any reference to a past state the current context does not contain"* succeeds because it enumerates triggers.
2. **No `user-invocable: true`.** Omitting it keeps the skill out of the slash-command menu so it only runs autonomously.

Each skill also has an explicit *"do not surface to the user"* rule — Claude's default instinct is to narrate tool use, and for a silent external memory that's wrong.

### 8.1. `.claude/skills/my-brain-context/SKILL.md`

The most important skill. Fires before Claude answers, grounding answers in actual project memory.

```markdown
---
name: my-brain-context
description: Automatically invoked at the start of any non-trivial response to silently enrich the working context with relevant long-term memory from the my-brain stack. Triggers when the user asks a question that may depend on prior project decisions, past conversations, code conventions, architectural choices, or any context established outside the current conversation window. Signal phrases include references to past work ("we", "earlier", "last time", "our", "the <something>"), questions about existing code or systems, requests to continue or extend something, or any ambiguity that past context could resolve. Calls the my-brain MCP server to perform semantic retrieval and folds results into the working context silently before the main answer is composed — the user does not see the retrieval step.
allowed-tools: mcp__my-brain__hooks_rag_context, mcp__my-brain__brain_search
---

# my-brain Context Retrieval

Runs silently before Claude answers. The user sees only the final answer.

## Procedure

1. Extract key entities and topics from the current user message.
2. Call `hooks_rag_context` with `top_k=5` and the extracted query.
3. If any result has similarity > 0.7, fold it into the working context as
   "Relevant prior memory: ..." — otherwise proceed without.
4. Never mention the retrieval to the user unless they explicitly ask.

## Quality heuristics

- Empty array from `hooks_rag_context` → do not mention memory at all.
- Contradictory results → prefer highest `relevance_score`.
- Results > 30 days old + current context suggests project has moved on → weight newer.

## Failure mode

If the MCP server is unreachable, skip silently. Never block the user on memory
availability. Log the failure for the curator agent to investigate later.
```

### 8.2. `.claude/skills/my-brain-capture/SKILL.md`

Writes durable knowledge back. Trigger deliberately narrow so it only fires on real signal.

```markdown
---
name: my-brain-capture
description: Automatically invoked after completing work that produced durable knowledge worth persisting beyond the current session. Triggers when a significant decision was made, a bug was diagnosed, an architecture was chosen, a convention was established, a non-obvious fix was found, or the user explicitly signals durability with phrases like "remember this", "save this", "for future", "note that", or "going forward". Does not trigger on routine Q&A, trivial code changes, or exploratory conversation. Persists the distilled knowledge to the my-brain stack via the brain_share MCP tool with appropriate metadata, silently — does not announce the save to the user.
allowed-tools: mcp__my-brain__brain_share, mcp__my-brain__brain_search
---

# my-brain Capture

Runs silently after durable work. Captures the lesson, not the transcript.

## What counts as durable

- A decision ("X was chosen over Y because...")
- A bug pattern and its fix
- A convention or style ruling
- An architectural trade-off
- A gotcha in a third-party library

## What does NOT count

- "Thanks", "ok", "run the tests"
- One-off code help with no general lesson
- Questions answered that are unlikely to recur

## Format for persistence

Each captured item:
- `content`: 1–3 sentences, third person, context-free (no "we", no "you").
- `type`: one of `decision | fix | convention | tradeoff | gotcha`.
- `tags`: 2–5 lowercase kebab-case strings.
- `source`: short descriptor, e.g. `conversation:<date>` or `file:<path>`.

Call `brain_share` with this structure. Do not surface the save unless the user
explicitly asks ("did you remember that?").

## Dedup

Before saving, call `brain_search` with `top_k=3`. If any result has similarity
> 0.85 to the candidate, do not re-save — update the existing memory's tags instead.
```

### 8.3. `.claude/skills/my-brain-recall/SKILL.md`

Surfaces memory into the conversation when the user asks directly. Distinct from `my-brain-context`: here, the memory *is* the answer.

```markdown
---
name: my-brain-recall
description: Automatically invoked when the user directly asks about past state, prior decisions, or the history of the project — not just questions that happen to need context, but questions where the memory content itself is the answer. Triggers on phrases like "what did we decide about", "why did we choose", "when did we", "what was that", "did we ever", "how did we solve", and questions that look up project state directly. Distinct from my-brain-context which silently enriches any answer; my-brain-recall is the explicit retrieval path where the retrieved memory becomes the user-facing response.
allowed-tools: mcp__my-brain__brain_search, mcp__my-brain__hooks_rag_context
---

# my-brain Recall

Explicit retrieval — the memory content is the user-facing answer.

## Retrieval

1. Call `brain_search` with `top_k=10` using the user's question as the query.
2. Filter to results with similarity > 0.6.
3. Group by tag, sort by recency.

## Presentation

- Quote memory content concisely; include dates and tags.
- Multiple memories that contradict → show both, note the conflict.
- No matches → "no memory found matching <X>". Do not invent.
- Results exist but user's question needs synthesis → hand retrieved results
  to the normal answer flow as context.
```

### 8.4. `.claude/skills/my-brain-session/SKILL.md`

Opens/closes learning sessions so SONA can track trajectories across the full arc.

```markdown
---
name: my-brain-session
description: Automatically invoked at the start of a new working session to open a tracked session on the my-brain stack, and again at the end to close it. Opens when no active session is detected (first user message, or first message after a >30 minute gap). Closes when the user signals completion ("done", "thanks, that's all", closing a PR, end of work) or after a long idle period. Enables SONA trajectory recording so the brain learns from the full session arc rather than isolated queries. Operates silently — session ids never shown to the user.
allowed-tools: mcp__my-brain__session_start, mcp__my-brain__session_end
---

# my-brain Session Management

Wraps the working session so SONA learns across trajectories.

## On open

- Detect: no active session id in the conversation OR a >30 min gap.
- Call `session_start` with a derived id (timestamp + short hash of first user message).
- Stash the id for the conversation duration. Do not surface.

## On close

- Detect: closure signals ("merged", "shipped", "done") or end-of-task cues.
- Call `session_end` — flushes SONA trajectory, triggers EWC++ consolidation.
- Do not announce.

## Edge cases

- Session never opened (skill loaded mid-conversation) → open lazily on next
  memory operation rather than retroactively.
- `session_end` fails → log and continue; server auto-closes stale sessions.
```

---

## 9. `.claude/agents/my-brain-curator.md` — maintenance subagent

A subagent runs in its own context, so periodic housekeeping doesn't pollute the main conversation.

```markdown
---
name: my-brain-curator
description: Invoked periodically or on explicit request to maintain the my-brain memory store — dedupes similar memories, repairs broken tags, reports SONA learning health, and prunes low-value entries. Runs in a separate context to keep the main conversation clean. Reports only a one-line summary unless something needs attention.
tools: mcp__my-brain__brain_search, mcp__my-brain__brain_agi_status, mcp__my-brain__brain_sona_stats, mcp__my-brain__brain_share
---

You are the curator for the my-brain external memory.

When invoked, run this checklist silently. Report only a one-line summary
("curated N memories, M merges, P prunes, SONA health: ok") unless something is wrong.

1. **Health**: call `brain_sona_stats` and `brain_agi_status`. If any metric
   looks degraded (learning-rate collapse, attractor divergence), surface it.
2. **Dedup**: sample 50 recent memories, find pairs with similarity > 0.9,
   merge (keep newer content, union tags).
3. **Tag hygiene**: memories with 0 tags or > 10 tags → auto-tag from content
   or trim to the 5 most semantically central tags.
4. **Prune**: memories > 90 days old with 0 recalls AND similarity > 0.8 to a
   newer, more-recalled memory → candidates for deletion.
```

---

## 10. `.mcp.json` — client discovery

```json
{
  "mcpServers": {
    "my-brain": {
      "type": "streamable-http",
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

Lives at the project root. Claude Code picks it up on startup; Cursor and VS Code Copilot honor the same convention via their settings. The server name `my-brain` becomes the tool-call prefix (`mcp__my-brain__hooks_rag_context`, etc.) — which is what the skills' `allowed-tools` entries reference above.

---

## 11. Bring-up checklist

```bash
# 1. Configure
cp .env.example .env
${EDITOR:-nano} .env          # at minimum: set MYBRAIN_DB_PASSWORD

# 2. Boot (memory mode, no LLM)
docker compose up -d
docker compose ps             # 3 services should be "healthy"

# 3. Verify DB + extension
docker exec my-brain-db psql -U mybrain -d mybrain_db -c \
  "SELECT ruvector_version();"

# 4. Verify REST
curl -s http://localhost:8080/health

# 5. Verify MCP
curl -s -X POST http://localhost:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 6. Upgrade to full mode later (optional)
echo "MYBRAIN_MODE=full" >> .env
echo "MYBRAIN_LLM_MODEL=qwen3.5:0.8b" >> .env
docker compose --profile full up -d
docker compose logs -f my-brain-llm-init    # watch the model pull (~1 GB)
```

When `tools/list` returns a ~103-entry JSON array (starting with `hooks_route`, `brain_search`, etc.), any MCP client pointed at `http://localhost:3333/mcp` has the full my-brain toolbelt — and the skills will start firing autonomously.

---

## 12. Gotchas collected from upstream issues

Things that *will* bite you if you don't know about them in advance, from upstream issues and ADRs:

1. **Extension version pinning.** `CREATE EXTENSION ruvector VERSION '0.1.0'` — the version string is mandatory. Skipping it gives a confusing error. Tracked in ruvector PR #136 ("fix: register embedding functions in extension SQL and install v2.0.0 schema in Docker") and claude-flow issue #963.
2. **ruvLLM ≠ generation.** The orchestrator does routing + memory + learning. If you want token generation in `full` mode, the backend (Ollama/mistral-rs) is mandatory. The npm `RuvLLM` class also accepts a `MistralBackend` with PagedAttention, X-LoRA, ISQ quantization if you want production serving inside the orchestrator process.
3. **Memory substrate is shared (ADR-002).** *"Use Ruvector's vector database with HNSW indexing, graph storage, and metadata capabilities as the single memory substrate for all RuvLLM concerns."* Three roles on top: **policy memory** (quantization thresholds, router weights, EWC++ Fisher, pattern bank), **session state** (KV cache keys, adapter refs, session graphs), **witness log** (routing decisions, quality scores, latency traces). Your orchestrator should create the three schemas on first connect; see `docs/ruvector-postgres/scripts/init-db.sql` upstream for a reference shape.
4. **KV cache state is precious.** TurboQuant (ICLR 2026, 2–4 bit async KV-cache quantization, issue #298) lives in `~/.ruvllm/`. The Compose mounts `state:/app/.mybrain` for exactly this — adapters + KV caches survive restarts.
5. **Federated coordinator pattern.** The ruvLLM example README shows "ephemeral agents A/B/C → central coordinator" as the horizontal-scale pattern. To stay compatible, keep the orchestrator **stateless except** for the `models:` and `state:` volumes; the DB is the only durable component.
6. **MCP transport fine print.** The Streamable HTTP spec says servers MUST validate `Origin` (DNS-rebinding protection), SHOULD bind to `127.0.0.1` when local, and SHOULD implement auth. `mcp-proxy` supports `--allow-origin` (wired above from `MYBRAIN_ALLOWED_MCP_ORIGINS`). Default `MYBRAIN_BIND_HOST=127.0.0.1` keeps you safe locally. If you expose `/mcp` to a LAN or internet, put a reverse proxy (Caddy/Traefik) with an Origin allowlist + auth in front.
7. **`npx ruvector mcp start` is stdio by default.** That's why `mcp-proxy` is in the stack — it bridges stdio to the Streamable-HTTP `/mcp` endpoint the spec requires. If a future ruvector release ships native Streamable-HTTP, swap the `my-brain-mcp` service for a direct run.
8. **Skills only trigger on *description*, not *body*.** When iterating on triggering accuracy, edit the `description` field — the body (instructions Claude reads *after* triggering) does not influence *when* the skill fires. If `my-brain-capture` fires too often/rarely, rewrite the description.
9. **Qwen3.5 model sizing.** `qwen3.5:0.8b` (1 GB) runs fine on CPU and is the recommended default. `qwen3.5:2b` (2.7 GB) is noticeably smarter and still CPU-viable on a modern laptop. Both expose `tools` and `thinking` capabilities Ollama-side, which matters if you later enable ruvLLM's tool-use routing. The separate `qwen3-embedding:0.6b` (639 MB) is a good companion if you want Ollama-managed embeddings instead of the bundled ONNX MiniLM.

---

## 13. TL;DR — the four anchors

If you read nothing else:

1. **`github.com/ruvnet/ruvector/tree/main/examples/ruvLLM`** — what ruvLLM actually is.
2. **`hub.docker.com/r/ruvnet/ruvector-postgres`** — the DB image and its config surface.
3. **`github.com/ruvnet/ruvector/blob/main/docs/adr/ADR-002-ruvllm-integration.md`** — how memory is split into policy / session / witness, all on one HNSW substrate.
4. **`modelcontextprotocol.io/specification/2025-03-26/basic/transports`** + **`github.com/sparfenyuk/mcp-proxy`** — how `/mcp` must behave, and the shortest bridge to make `npx ruvector mcp start` behave that way.

Everything else in this document is orchestration around those four anchors — branded as `my-brain`, configured by `.env`, and made autonomous through carefully-triggered, silent skills.
