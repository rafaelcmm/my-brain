import http from "node:http";
import { createRequire } from "node:module";
import { Pool } from "pg";

const FULL_MODE = "full";
const ADR_SCHEMAS = ["policy_memory", "session_memory", "witness_memory"];
const MEMORY_TYPES = new Set([
  "decision",
  "fix",
  "convention",
  "gotcha",
  "tradeoff",
  "pattern",
  "reference",
]);
const MEMORY_SCOPES = new Set(["repo", "project", "global"]);
const MEMORY_VISIBILITY = new Set(["private", "team", "public"]);

const require = createRequire(import.meta.url);

const { createIntelligenceEngine } = require("ruvector");
const { RuvLLM } = require("@ruvector/ruvllm");

/**
 * Parses a boolean-like environment variable while keeping defaults explicit.
 *
 * @param {string | undefined} value Raw environment value.
 * @param {boolean} fallback Boolean used when input is missing or malformed.
 * @returns {boolean} Parsed boolean that preserves operator intent.
 */
function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

/**
 * Parses an integer environment value while keeping fallback deterministic.
 *
 * @param {string | undefined} value Raw environment value.
 * @param {number} fallback Value used when parsing fails.
 * @returns {number} Integer value used by runtime bootstrap.
 */
function parseInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normalizes text fields by trimming and enforcing upper size bounds.
 *
 * @param {unknown} value Candidate user-provided value.
 * @param {number} maxLength Hard max size accepted by storage model.
 * @returns {string | null} Sanitized string or null when value is unusable.
 */
function sanitizeText(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

/**
 * Normalizes tag arrays and drops invalid entries to reduce noisy metadata.
 *
 * @param {unknown} value Candidate tags payload.
 * @returns {string[]} Sanitized unique tag array capped to five entries.
 */
function sanitizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const tag = item.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,32}$/.test(tag)) {
      continue;
    }

    unique.add(tag);
    if (unique.size >= 5) {
      break;
    }
  }

  return Array.from(unique);
}

/**
 * Validates and sanitizes metadata memory envelopes for mb write endpoints.
 *
 * The result is reused by handlers so business rules stay consistent across
 * remember, vote, and digest flows.
 *
 * @param {unknown} payload Raw request payload.
 * @returns {{valid: boolean, errors: string[], envelope?: Record<string, unknown>}} Validation result.
 */
function validateMemoryEnvelope(payload) {
  const errors = [];

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { valid: false, errors: ["payload must be an object"] };
  }

  const body = /** @type {Record<string, unknown>} */ (payload);
  const content = sanitizeText(body.content, 8192);
  if (!content) {
    errors.push("content must be a non-empty string");
  }

  const type = sanitizeText(body.type, 32)?.toLowerCase();
  if (!type || !MEMORY_TYPES.has(type)) {
    errors.push("type must be one of: decision, fix, convention, gotcha, tradeoff, pattern, reference");
  }

  const scope = sanitizeText(body.scope, 16)?.toLowerCase();
  if (!scope || !MEMORY_SCOPES.has(scope)) {
    errors.push("scope must be one of: repo, project, global");
  }

  const metadataRaw =
    typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
      ? /** @type {Record<string, unknown>} */ (body.metadata)
      : {};

  const confidence = metadataRaw.confidence;
  if (
    confidence !== undefined &&
    (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1)
  ) {
    errors.push("metadata.confidence must be a number between 0 and 1");
  }

  const visibility = sanitizeText(metadataRaw.visibility, 16)?.toLowerCase();
  if (visibility && !MEMORY_VISIBILITY.has(visibility)) {
    errors.push("metadata.visibility must be one of: private, team, public");
  }

  const tags = sanitizeTags(metadataRaw.tags);
  const frameworks = Array.isArray(metadataRaw.frameworks)
    ? metadataRaw.frameworks
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 2 && value.length <= 32)
        .slice(0, 8)
    : [];

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    envelope: {
      content,
      type,
      scope,
      metadata: {
        repo: sanitizeText(metadataRaw.repo, 256),
        repo_name: sanitizeText(metadataRaw.repo_name, 128),
        project: sanitizeText(metadataRaw.project, 128),
        language: sanitizeText(metadataRaw.language, 64),
        frameworks,
        path: sanitizeText(metadataRaw.path, 512),
        symbol: sanitizeText(metadataRaw.symbol, 256),
        tags,
        source: sanitizeText(metadataRaw.source, 256),
        author: sanitizeText(metadataRaw.author, 256),
        agent: sanitizeText(metadataRaw.agent, 128),
        created_at: sanitizeText(metadataRaw.created_at, 64),
        expires_at: sanitizeText(metadataRaw.expires_at, 64),
        confidence: typeof confidence === "number" ? confidence : null,
        visibility: visibility ?? "private",
      },
    },
  };
}

/**
 * Loads runtime configuration once so handlers remain deterministic.
 *
 * @returns {{
 * mode: string,
 * logLevel: string,
 * llmModel: string,
 * dbUrl: string,
 * llmUrl: string,
 * sonaEnabled: boolean,
 * }} Sanitized configuration consumed by request handlers.
 */
function loadConfig() {
  return {
    // Full mode is now the only supported runtime profile. Keeping the field
    // stable avoids breaking existing health/status consumers while removing
    // the dormant configuration branch that no longer changes behavior.
    mode: FULL_MODE,
    logLevel: process.env.MYBRAIN_LOG_LEVEL ?? "info",
    llmModel: process.env.MYBRAIN_LLM_MODEL ?? "qwen3.5:0.8b",
    dbUrl: process.env.MYBRAIN_DB_URL ?? "",
    llmUrl: process.env.MYBRAIN_LLM_URL ?? "",
    embeddingModel: process.env.MYBRAIN_EMBEDDING_MODEL ?? "qwen3-embedding:0.6b",
    embeddingDim: parseInteger(process.env.MYBRAIN_EMBEDDING_DIM, 1024),
    vectorPort: parseInteger(process.env.RUVECTOR_PORT, 8080),
    sonaEnabled: parseBoolean(process.env.RUVLLM_SONA_ENABLED, true),
  };
}

const config = loadConfig();

/**
 * Tracks bootstrapped runtime state exposed through status/capabilities routes.
 *
 * Fields intentionally mirror hooks_capabilities so clients can reuse existing
 * parsing logic while this orchestrator owns runtime composition.
 */
const runtime = {
  initializedAt: null,
  db: {
    connected: false,
    extensionVersion: null,
    adrSchemasReady: false,
    error: null,
  },
  llm: {
    loaded: false,
    error: null,
  },
  engine: {
    loaded: false,
    sona: false,
    attention: false,
    embeddingDim: config.embeddingDim,
    error: null,
  },
  degradedReasons: [],
  pool: null,
  intelligenceEngine: null,
  llmEngine: null,
};

/**
 * Records degradation reasons once so diagnostics remain concise.
 *
 * @param {string} reason Human-readable runtime degradation reason.
 * @returns {void}
 */
function pushDegradedReason(reason) {
  if (!runtime.degradedReasons.includes(reason)) {
    runtime.degradedReasons.push(reason);
  }
}

/**
 * Ensures ADR-002 memory schemas exist before traffic starts.
 *
 * @param {Pool} pool Active Postgres pool.
 * @returns {Promise<void>}
 */
async function ensureAdrSchemas(pool) {
  for (const schema of ADR_SCHEMAS) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.entries (
        id BIGSERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'general',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_brain_memory_metadata (
      id BIGSERIAL PRIMARY KEY,
      memory_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      repo TEXT,
      repo_name TEXT,
      project TEXT,
      language TEXT,
      frameworks JSONB NOT NULL DEFAULT '[]'::jsonb,
      path TEXT,
      symbol TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      source TEXT,
      author TEXT,
      agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      confidence DOUBLE PRECISION,
      visibility TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

/**
 * Initializes Postgres connectivity and validates required extension version.
 *
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
  if (!config.dbUrl) {
    runtime.db.error = "MYBRAIN_DB_URL not configured";
    pushDegradedReason("database url missing");
    return;
  }

  const pool = new Pool({ connectionString: config.dbUrl });
  runtime.pool = pool;

  try {
    const versionResult = await pool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'ruvector' LIMIT 1",
    );
    const extensionVersion = versionResult.rows[0]?.extversion;

    if (!extensionVersion) {
      runtime.db.error = "ruvector extension not installed";
      pushDegradedReason("ruvector extension missing");
      return;
    }

    runtime.db.connected = true;
    runtime.db.extensionVersion = extensionVersion;

    await ensureAdrSchemas(pool);
    runtime.db.adrSchemasReady = true;
  } catch (error) {
    runtime.db.error = error instanceof Error ? error.message : String(error);
    pushDegradedReason("database bootstrap failed");
  }
}

/**
 * Initializes intelligence engine with embedding/learning features enabled.
 *
 * @returns {void}
 */
function initializeIntelligenceEngine() {
  try {
    runtime.intelligenceEngine = createIntelligenceEngine({
      embeddingDim: config.embeddingDim,
      maxMemories: 100000,
      enableSona: config.sonaEnabled,
      enableAttention: true,
    });

    runtime.engine.loaded = true;

    const stats = runtime.intelligenceEngine.getStats();
    runtime.engine.sona = Boolean(stats?.sonaEnabled);
    runtime.engine.attention = Boolean(stats?.attentionEnabled);
    runtime.engine.embeddingDim = Number(stats?.memoryDimensions ?? config.embeddingDim);
  } catch (error) {
    runtime.engine.error = error instanceof Error ? error.message : String(error);
    pushDegradedReason("intelligence engine failed");
  }
}

/**
 * Initializes RuvLLM runtime so capabilities include active LLM layer state.
 *
 * @returns {void}
 */
function initializeLlmRuntime() {
  try {
    runtime.llmEngine = new RuvLLM({
      modelPath: config.llmModel,
      sonaEnabled: config.sonaEnabled,
      flashAttention: true,
      maxTokens: 512,
      temperature: 0.7,
      topP: 0.9,
      embeddingDim: config.embeddingDim,
    });
    runtime.llm.loaded = true;
  } catch (error) {
    runtime.llm.error = error instanceof Error ? error.message : String(error);
    pushDegradedReason("llm runtime failed");
  }
}

/**
 * Executes full runtime bootstrap before server accepts traffic.
 *
 * @returns {Promise<void>}
 */
async function initializeRuntime() {
  await initializeDatabase();
  initializeIntelligenceEngine();
  initializeLlmRuntime();
  runtime.initializedAt = new Date().toISOString();
}

/**
 * Builds capability payload used by `/v1/capabilities` and health diagnostics.
 *
 * @returns {{engine: boolean, vectorDb: boolean, sona: boolean, attention: boolean, embeddingDim: number}} Capability flags.
 */
function getCapabilities() {
  return {
    engine: runtime.engine.loaded,
    vectorDb: runtime.db.connected && runtime.db.adrSchemasReady,
    sona: runtime.engine.sona,
    attention: runtime.engine.attention,
    embeddingDim: runtime.engine.embeddingDim,
  };
}

/**
 * Sends JSON responses with stable content-type and status handling.
 *
 * @param {http.ServerResponse} res Node response object.
 * @param {number} status HTTP status code.
 * @param {Record<string, unknown>} payload Response body.
 * @returns {void}
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/**
 * Handles known routes used by gateway probes and operator diagnostics.
 *
 * @param {http.IncomingMessage} req HTTP request.
 * @param {http.ServerResponse} res HTTP response.
 * @returns {void}
 */
function handleRequest(req, res) {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "GET" && url === "/health") {
    const capabilities = getCapabilities();
    sendJson(res, 200, {
      status: "ok",
      service: "my-brain-orchestrator",
      mode: config.mode,
      sonaEnabled: config.sonaEnabled,
      degraded: runtime.degradedReasons.length > 0,
      capabilities,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && url === "/v1/status") {
    sendJson(res, 200, {
      service: "my-brain-orchestrator",
      mode: config.mode,
      runtime: {
        initializedAt: runtime.initializedAt,
        degradedReasons: runtime.degradedReasons,
      },
      llm: {
        model: config.llmModel,
        endpoint: config.llmUrl,
        loaded: runtime.llm.loaded,
        error: runtime.llm.error,
      },
      memory: {
        dbConfigured: config.dbUrl.length > 0,
        dbConnected: runtime.db.connected,
        extensionVersion: runtime.db.extensionVersion,
        adrSchemasReady: runtime.db.adrSchemasReady,
        error: runtime.db.error,
      },
    });
    return;
  }

  if (method === "GET" && url === "/v1/capabilities") {
    const capabilities = getCapabilities();
    sendJson(res, 200, {
      success: true,
      capabilities,
      features: {
        vectorDb: capabilities.vectorDb ? "HNSW indexing enabled" : "Brute-force fallback",
        sona: capabilities.sona ? "SONA adaptive learning" : "Q-learning fallback",
        attention: capabilities.attention ? "Self-attention embeddings" : "Hash embeddings",
        embeddingDim: capabilities.embeddingDim,
      },
      degradedReasons: runtime.degradedReasons,
      db: {
        extensionVersion: runtime.db.extensionVersion,
        adrSchemasReady: runtime.db.adrSchemasReady,
      },
    });
    return;
  }

  sendJson(res, 404, {
    error: "not_found",
    message: "Route not implemented in bootstrap orchestrator",
  });
}

const server = http.createServer(handleRequest);

initializeRuntime()
  .catch((error) => {
    pushDegradedReason("runtime initialization threw");
    process.stderr.write(
      `[my-brain] runtime initialization failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  })
  .finally(() => {
    server.listen(config.vectorPort, "0.0.0.0", () => {
      process.stdout.write(
        `[my-brain] orchestrator listening on :${config.vectorPort} mode=${config.mode} log=${config.logLevel}\n`,
      );
    });
  });
