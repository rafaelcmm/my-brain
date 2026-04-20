import http from "node:http";
import { createRequire } from "node:module";
import { Pool } from "pg";

const FULL_MODE = "full";
const ADR_SCHEMAS = ["policy_memory", "session_memory", "witness_memory"];

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
