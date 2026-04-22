import http from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { initializeDatabase as _initializeDatabase } from "./infrastructure/postgres.js";
import {
  findDuplicateMemory as _findDuplicateMemory,
  loadVoteBias as _loadVoteBias,
  persistMemoryMetadata as _persistMemoryMetadata,
  queryRecallCandidates as _queryRecallCandidates,
} from "./infrastructure/postgres-memory.js";
import {
  loadConfig,
  parseBoolean,
  parseInteger,
} from "./config/load-config.js";
import { asVector, contentFingerprint } from "./domain/fingerprint.js";
import {
  sanitizeTags,
  sanitizeText,
  validateMemoryEnvelope,
} from "./domain/memory-validation.js";
import {
  incrementMetric,
  observeDurationMs,
  renderMetrics,
} from "./observability/metrics.js";
import { allowRequest } from "./policies/rate-limit.js";
import {
  MIN_TOKEN_LENGTH,
  hasValidInternalKey as checkInternalKey,
  validateAuthToken as checkAuthToken,
} from "./policies/auth.js";
import {
  logInternalError as _logInternalError,
  pushDegradedReason as _pushDegradedReason,
  sanitizeStatusError,
} from "./observability/log.js";
import {
  normalizeRepoSelector,
  parseRemoteRepo as parseNormalizedRemoteRepo,
} from "./domain/project-context.js";
import { lexicalBoost, similarity, voteBias } from "./domain/scoring.js";
import { ADR_SCHEMAS } from "./domain/types.js";
import {
  initializeIntelligenceEngine as _initializeIntelligenceEngine,
  initializeLlmRuntime as _initializeLlmRuntime,
} from "./infrastructure/intelligence.js";
import {
  embedText as _embedText,
  getCachedEmbedding as _getCachedEmbedding,
  initializeEmbeddingProvider as _initializeEmbeddingProvider,
} from "./infrastructure/embedding.js";
import { runGitCommand as _runGitCommand } from "./infrastructure/git.js";

// MIN_TOKEN_LENGTH is owned by policies/auth.ts and re-exported there.
const MAX_REQUEST_BODY_BYTES = parseInteger(
  process.env.MYBRAIN_MAX_REQUEST_BODY_BYTES,
  1048576,
);

const require = createRequire(import.meta.url);

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
  embedding: {
    ready: false,
    dim: config.embeddingDim,
    provider: "fallback",
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
  learning: {
    sessionsOpened: 0,
    sessionsClosed: 0,
    successfulSessions: 0,
    failedSessions: 0,
    totalQuality: 0,
    currentRoute: "default",
    routeConfidence: 0.5,
  },
};

const rateWindowMs = 60_000;
const embeddingCache = new Map();
const maxEmbeddingCacheSize = 400;
const bridgeCapabilitiesCacheMs = 10_000;

/**
 * Records degradation reasons once so diagnostics remain concise.
 *
 * @param {string} reason Human-readable runtime degradation reason.
 * @returns {void}
 */
function pushDegradedReason(reason) {
  _pushDegradedReason(runtime.degradedReasons, reason);
}

/**
 * Converts internal runtime errors into non-sensitive status labels.
 *
 * @param {string | null} errorMessage Internal error string.
 * @returns {string | null} Safe status value.
 */
// sanitizeStatusError is re-exported directly from observability/log.ts

/**
 * Logs failures without exposing internal details outside debug mode.
 *
 * @param {string} context Stable operation context.
 * @param {unknown} error Caught error object.
 * @returns {void}
 */
function logInternalError(context, error) {
  _logInternalError(context, error, config.logLevel);
}

// ensureAdrSchemas is owned by infrastructure/postgres.ts

/**
 * Initializes Postgres connectivity and validates required extension version.
 *
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
  const pool = await _initializeDatabase(
    { dbUrl: config.dbUrl, embeddingDim: config.embeddingDim },
    runtime.db,
    pushDegradedReason,
  );
  if (pool) {
    runtime.pool = pool;
  }
}

/**
 * Initializes intelligence engine — delegates to infrastructure/intelligence.ts.
 *
 * @returns {void}
 */
function initializeIntelligenceEngine() {
  runtime.intelligenceEngine = _initializeIntelligenceEngine(
    {
      embeddingDim: config.embeddingDim,
      sonaEnabled: config.sonaEnabled,
      llmModel: config.llmModel,
    },
    runtime.engine,
    pushDegradedReason,
  );
}

/**
 * Initializes RuvLLM runtime — delegates to infrastructure/intelligence.ts.
 *
 * @returns {void}
 */
function initializeLlmRuntime() {
  runtime.llmEngine = _initializeLlmRuntime(
    {
      embeddingDim: config.embeddingDim,
      sonaEnabled: config.sonaEnabled,
      llmModel: config.llmModel,
    },
    runtime.llm,
    pushDegradedReason,
  );
}

/**
 * Validates auth token meets security requirements before allowing startup.
 *
 * @returns {boolean} True when token validation succeeds.
 */
function validateAuthToken() {
  return checkAuthToken(config, runtime.degradedReasons);
}

/**
 * Executes full runtime bootstrap before server accepts traffic.
 *
 * @returns {Promise<void>}
 */
async function initializeRuntime() {
  if (!config.internalApiKey) {
    throw new Error("MYBRAIN_INTERNAL_API_KEY is required");
  }

  if (!validateAuthToken()) {
    pushDegradedReason("orchestrator token validation failed");
  }
  await initializeDatabase();
  initializeIntelligenceEngine();
  initializeLlmRuntime();
  runtime.initializedAt = new Date().toISOString();
  await initializeEmbeddingProvider();
  runtime.engine.loaded =
    runtime.db.connected &&
    runtime.db.adrSchemasReady &&
    runtime.embedding.ready &&
    Boolean(runtime.intelligenceEngine);
  if (!runtime.engine.loaded) {
    pushDegradedReason("engine warmup incomplete");
  }
}

/**
 * Initializes embedding provider against Ollama and validates vector dimension.
 *
 * @returns {Promise<void>}
 */
async function initializeEmbeddingProvider() {
  await _initializeEmbeddingProvider(
    { llmUrl: config.llmUrl, embeddingModel: config.embeddingModel },
    runtime.embedding,
    runtime.engine,
    pushDegradedReason,
  );
}

/**
 * Computes embedding vector — delegates to infrastructure/embedding.ts.
 *
 * @param {string} content Source text to embed.
 * @returns {Promise<number[]>} Embedding vector.
 */
async function embedText(content) {
  return _embedText(
    content,
    runtime.embedding,
    { llmUrl: config.llmUrl, embeddingModel: config.embeddingModel },
    runtime.intelligenceEngine,
  );
}

/**
 * Builds capability payload used by `/v1/capabilities` and health diagnostics.
 *
 * @returns {{engine: boolean, vectorDb: boolean, sona: boolean, attention: boolean, embeddingDim: number}} Capability flags.
 */
function getCapabilities() {
  const vectorReady = runtime.db.connected && runtime.db.adrSchemasReady;
  const engineReady = runtime.engine.loaded && runtime.embedding.ready;
  return {
    engine: engineReady,
    vectorDb: vectorReady,
    sona: runtime.engine.sona,
    attention: runtime.engine.attention,
    embeddingDim: runtime.embedding.dim,
  };
}

/**
 * Computes similarity threshold policy based on runtime quality mode.
 *
 * @returns {number} Minimum score accepted for recall responses.
 */
function getDefaultRecallThreshold() {
  return runtime.engine.loaded ? 0.6 : 0.85;
}

/**
 * Runs metadata-first candidate selection for scoped recall.
 *
 * @param {Record<string, unknown>} filters Recall filter payload.
 * @param {number} limit Candidate row limit for scoring stage.
 * @param {number[] | null} queryEmbedding Optional query vector for ANN ordering.
 * @returns {Promise<Array<Record<string, unknown>>>} Candidate metadata rows.
 */
async function queryRecallCandidates(filters, limit, queryEmbedding = null) {
  if (!runtime.pool) {
    return [];
  }
  return _queryRecallCandidates(runtime.pool, filters, limit, queryEmbedding);
}

/**
 * Finds duplicate memory candidate within scoped metadata boundaries.
 *
 * @param {Record<string, unknown>} envelope Validated memory envelope.
 * @param {number[]} embedding Embedding for memory content.
 * @returns {Promise<{memoryId: string, score: number, reason: string} | null>} Duplicate match result.
 */
async function findDuplicateMemory(envelope, embedding) {
  if (!runtime.pool) {
    return null;
  }
  return _findDuplicateMemory(
    runtime.pool,
    envelope,
    embedding,
    runtime.embedding.ready,
  );
}

/**
 * Loads aggregate vote counts and computed bias for memory ids.
 *
 * @param {string[]} memoryIds Memory ids in current recall page.
 * @returns {Promise<Map<string, {up: number, down: number, bias: number}>>} Vote aggregates.
 */
async function loadVoteBias(memoryIds) {
  if (!runtime.pool || memoryIds.length === 0) {
    return new Map();
  }
  return _loadVoteBias(runtime.pool, memoryIds);
}

/**
 * Parses digest window input to bounded SQL interval value.
 *
 * @param {unknown} value Raw digest window value (for example 1w, 7d, 24h).
 * @returns {string} SQL interval expression used for digest filtering.
 */
function normalizeDigestSince(value) {
  if (typeof value !== "string") {
    return "7 days";
  }

  const normalized = value.trim().toLowerCase();
  const weekMatch = normalized.match(/^(\d{1,2})w$/);
  if (weekMatch) {
    return `${weekMatch[1]} weeks`;
  }

  const dayMatch = normalized.match(/^(\d{1,3})d$/);
  if (dayMatch) {
    return `${dayMatch[1]} days`;
  }

  const hourMatch = normalized.match(/^(\d{1,3})h$/);
  if (hourMatch) {
    return `${hourMatch[1]} hours`;
  }

  return "7 days";
}

/**
 * Backfills legacy metadata rows missing fingerprints or embeddings.
 *
 * The backfill keeps existing values intact and only populates missing fields
 * so it can be run repeatedly without rewriting healthy rows.
 *
 * @param {number} batchSize Maximum number of rows to process.
 * @returns {Promise<{processed: number, updated: number}>} Backfill counters.
 */
async function backfillMemoryMetadata(batchSize) {
  if (!runtime.pool) {
    return { processed: 0, updated: 0 };
  }

  const selected = await runtime.pool.query(
    `SELECT memory_id, content, content_sha1, embedding, embedding_vector
     FROM my_brain_memory_metadata
     WHERE content_sha1 IS NULL
        OR embedding IS NULL
        OR jsonb_typeof(embedding) <> 'array'
        OR embedding_vector IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize],
  );

  let updated = 0;
  for (const row of selected.rows) {
    const content = typeof row.content === "string" ? row.content : "";
    if (!content) {
      continue;
    }

    const fingerprint =
      typeof row.content_sha1 === "string" && row.content_sha1.length > 0
        ? row.content_sha1
        : contentFingerprint(content);
    const existingEmbedding = asVector(row.embedding);
    const embedding = existingEmbedding ?? (await getCachedEmbedding(content));

    await runtime.pool.query(
      `UPDATE my_brain_memory_metadata
       SET content_sha1 = COALESCE(content_sha1, $2),
           embedding = CASE
             WHEN embedding IS NULL OR jsonb_typeof(embedding) <> 'array' THEN $3::jsonb
             ELSE embedding
           END,
           embedding_vector = COALESCE(embedding_vector, $4::ruvector)
       WHERE memory_id = $1`,
      [
        row.memory_id,
        fingerprint,
        JSON.stringify(embedding),
        JSON.stringify(embedding),
      ],
    );

    updated += 1;
  }

  return { processed: selected.rows.length, updated };
}

/**
 * Reads request body as JSON object and fails closed on malformed payloads.
 *
 * @param {http.IncomingMessage} req Incoming HTTP request stream.
 * @returns {Promise<Record<string, unknown>>} Parsed JSON object payload.
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let totalBytes = 0;

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error("request timeout"));
    }, 30000);

    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }

      chunks.push(buffer);
    });

    req.on("end", () => {
      clearTimeout(timeout);

      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!text) {
          resolve({});
          return;
        }

        const parsed = JSON.parse(text);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          reject(new Error("JSON body must be an object"));
          return;
        }

        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Executes safe git command to derive project context metadata.
 *
 * @param {string[]} args Git command arguments.
 * @returns {string | null} Command stdout when successful.
 */
function runGitCommand(args, cwd = process.cwd()) {
  return _runGitCommand(args, cwd);
}

/**
 * Retrieves cached embedding for repeated recall scoring.
 *
 * @param {string} content Memory content string.
 * @returns {Promise<number[]>} Embedding vector.
 */
async function getCachedEmbedding(content) {
  return _getCachedEmbedding(
    content,
    embeddingCache,
    maxEmbeddingCacheSize,
    embedText,
  );
}

/**
 * Converts common git URL formats into normalized repo and short repo_name.
 *
 * @param {string | null} remoteUrl Git remote URL candidate.
 * @returns {{repo: string | null, repo_name: string | null}} Normalized identifiers.
 */
function parseRemoteRepo(remoteUrl) {
  return parseNormalizedRemoteRepo(remoteUrl);
}

/**
 * Detects probable language from cwd and manifest hints.
 *
 * @param {string} cwd Workspace directory to inspect.
 * @returns {string} Derived language label.
 */
function detectLanguage(cwd) {
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) {
    return "python";
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    return "rust";
  }
  if (fs.existsSync(path.join(cwd, "go.mod"))) {
    return "go";
  }
  return "javascript";
}

/**
 * Detects active frameworks using manifest files in current workspace.
 *
 * @returns {string[]} Framework identifiers used as context metadata.
 */
function detectFrameworks(cwd = process.cwd()) {
  const frameworks = new Set();

  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      if (deps.react) frameworks.add("react");
      if (deps.next) frameworks.add("nextjs");
      if (deps.express) frameworks.add("express");
      if (deps.hono) frameworks.add("hono");
      if (deps.typescript) frameworks.add("typescript");
      if (deps["@modelcontextprotocol/sdk"]) frameworks.add("mcp");
    } catch {
      // Keep probe resilient if package.json is malformed.
    }
  }

  if (fs.existsSync(path.join(cwd, "docker-compose.yml"))) {
    frameworks.add("docker");
  }

  if (fs.existsSync(path.join(cwd, "src", "gateway", "Caddyfile"))) {
    frameworks.add("caddy");
  }

  return Array.from(frameworks);
}

/**
 * Derives project context used by capture and recall flows.
 *
 * @returns {Record<string, unknown>} Project context envelope.
 */
function buildProjectContext(hints = {}) {
  const hintedCwd = sanitizeText(hints.cwd, 512);
  const cwd = hintedCwd && fs.existsSync(hintedCwd) ? hintedCwd : process.cwd();
  const hintedRemote = sanitizeText(hints.git_remote, 512);
  const remoteOrigin =
    hintedRemote ??
    runGitCommand(["config", "--get", "remote.origin.url"], cwd);
  const author =
    sanitizeText(hints.author, 256) ??
    runGitCommand(["config", "--get", "user.name"], cwd) ??
    runGitCommand(["config", "--get", "user.email"], cwd);
  const { repo, repo_name: repoName } = parseRemoteRepo(remoteOrigin);
  const hintedRepo = sanitizeText(hints.repo_hint, 256);
  const hintedRepoName = sanitizeText(hints.repo_name, 128);
  const hintedLanguage = sanitizeText(hints.language_hint, 64);
  const hintFrameworks = Array.isArray(hints.framework_hints)
    ? hints.framework_hints
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const detectedFrameworks = detectFrameworks(cwd);
  const frameworks =
    hintFrameworks.length > 0 ? hintFrameworks : detectedFrameworks;
  const language = hintedLanguage ?? detectLanguage(cwd);

  let source = "server-fallback";
  if (hintedRemote || hintedRepo || hintedRepoName || hintedLanguage) {
    source = "client-hint";
  } else if (repo || repoName) {
    source = "git";
  } else if (fs.existsSync(path.join(cwd, "package.json"))) {
    source = "package-json";
  } else if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    source = "cargo-toml";
  } else if (fs.existsSync(path.join(cwd, "pyproject.toml"))) {
    source = "pyproject";
  }

  return {
    repo: hintedRepo ?? repo,
    repo_name: hintedRepoName ?? repoName,
    project:
      sanitizeText(hints.project_hint, 128) ??
      hintedRepoName ??
      repoName ??
      null,
    language,
    frameworks,
    author,
    source,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Persists sidecar metadata row for a newly remembered memory.
 *
 * @param {string} memoryId Stable memory identifier from memory engine.
 * @param {Record<string, unknown>} envelope Validated metadata envelope.
 * @returns {Promise<void>}
 */
async function persistMemoryMetadata(memoryId, envelope) {
  if (!runtime.pool) {
    pushDegradedReason("metadata persistence unavailable");
    return;
  }
  await _persistMemoryMetadata(runtime.pool, memoryId, envelope);
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
 * Validates internal service header used between trusted local components.
 *
 * @param {http.IncomingMessage} req Incoming request.
 * @returns {boolean} True when request carries valid internal key.
 */
function hasValidInternalKey(req) {
  return checkInternalKey(req, config.internalApiKey);
}

/**
 * Handles orchestrator HTTP API routes for health, capabilities, and memory flows.
 *
 * @param {http.IncomingMessage} req HTTP request.
 * @param {http.ServerResponse} res HTTP response.
 * @returns {void}
 */
async function handleRequest(req, res) {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  const publicRoutes = new Set(["/health", "/ready"]);
  if (!publicRoutes.has(url) && !hasValidInternalKey(req)) {
    sendJson(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "missing or invalid internal service key",
    });
    return;
  }

  if (method === "GET" && url === "/health") {
    incrementMetric("my_brain_http_requests_total", {
      route: "/health",
      status: "200",
    });
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

  if (method === "GET" && url === "/ready") {
    const capabilities = getCapabilities();
    const ready =
      capabilities.engine &&
      runtime.db.connected &&
      runtime.db.adrSchemasReady &&
      runtime.llm.loaded;

    if (!ready) {
      incrementMetric("my_brain_http_requests_total", {
        route: "/ready",
        status: "503",
      });
      sendJson(res, 503, {
        status: "not_ready",
        service: "my-brain-orchestrator",
        message: "service dependencies unavailable",
      });
      return;
    }

    incrementMetric("my_brain_http_requests_total", {
      route: "/ready",
      status: "200",
    });

    sendJson(res, 200, {
      status: "ready",
      service: "my-brain-orchestrator",
    });
    return;
  }

  if (method === "GET" && url === "/v1/status") {
    incrementMetric("my_brain_http_requests_total", {
      route: "/v1/status",
      status: "200",
    });
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
        error: sanitizeStatusError(runtime.llm.error),
      },
      memory: {
        dbConfigured: config.dbUrl.length > 0,
        dbConnected: runtime.db.connected,
        extensionVersion: runtime.db.extensionVersion,
        adrSchemasReady: runtime.db.adrSchemasReady,
        error: sanitizeStatusError(runtime.db.error),
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
        vectorDb: capabilities.vectorDb
          ? "HNSW indexing enabled"
          : "Brute-force fallback",
        sona: capabilities.sona
          ? "SONA adaptive learning"
          : "Q-learning fallback",
        attention: capabilities.attention
          ? "Self-attention embeddings"
          : "Hash embeddings",
        embeddingDim: capabilities.embeddingDim,
      },
      degradedReasons: runtime.degradedReasons,
      db: {
        extensionVersion: runtime.db.extensionVersion,
        adrSchemasReady: runtime.db.adrSchemasReady,
        embeddingProvider: runtime.embedding.provider,
        embeddingReady: runtime.embedding.ready,
      },
    });
    return;
  }

  if (method === "GET" && url === "/v1/learning/stats") {
    const sessionsClosed = Math.max(runtime.learning.sessionsClosed, 1);
    const avgQuality = runtime.learning.totalQuality / sessionsClosed;

    sendJson(res, 200, {
      success: true,
      learning: {
        sessions_opened: runtime.learning.sessionsOpened,
        sessions_closed: runtime.learning.sessionsClosed,
        successful_sessions: runtime.learning.successfulSessions,
        failed_sessions: runtime.learning.failedSessions,
        average_quality: Number(avgQuality.toFixed(3)),
        route: runtime.learning.currentRoute,
        route_confidence: Number(runtime.learning.routeConfidence.toFixed(3)),
      },
    });
    return;
  }

  if (method === "GET" && url === "/metrics") {
    res.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
    res.end(renderMetrics());
    return;
  }

  if (method === "POST" && url === "/v1/context/probe") {
    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch {
      payload = {};
    }

    sendJson(res, 200, {
      success: true,
      context: buildProjectContext(payload),
      degraded: runtime.degradedReasons.length > 0,
    });
    return;
  }

  if (method === "POST" && url === "/v1/memory") {
    if (!allowRequest(req, "memory-write")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory write rate limit exceeded",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const validation = validateMemoryEnvelope(payload);
    if (!validation.valid || !validation.envelope) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "memory envelope validation failed",
        details: validation.errors,
      });
      return;
    }

    const envelope = validation.envelope;
    const context = buildProjectContext(payload);
    envelope.metadata = {
      ...(envelope.metadata ?? {}),
      repo: envelope.metadata?.repo ?? context.repo,
      repo_name: envelope.metadata?.repo_name ?? context.repo_name,
      project: envelope.metadata?.project ?? context.project,
      language: envelope.metadata?.language ?? context.language,
      frameworks:
        Array.isArray(envelope.metadata?.frameworks) &&
        envelope.metadata.frameworks.length > 0
          ? envelope.metadata.frameworks
          : context.frameworks,
      author: envelope.metadata?.author ?? context.author,
      source: envelope.metadata?.source ?? context.source,
    };

    if (!runtime.intelligenceEngine) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "memory engine unavailable",
      });
      return;
    }

    try {
      const embedding = await embedText(envelope.content);
      envelope.metadata = {
        ...(envelope.metadata ?? {}),
        embedding,
      };

      const duplicate = await findDuplicateMemory(envelope, embedding);
      if (duplicate && runtime.pool) {
        await runtime.pool.query(
          `UPDATE my_brain_memory_metadata
           SET use_count = use_count + 1,
               last_seen_at = NOW(),
               content = $2,
               metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{last_seen_at}', to_jsonb(NOW()::text), true)
           WHERE memory_id = $1`,
          [duplicate.memoryId, envelope.content],
        );
        incrementMetric("mb_dedup_hits_total");
        incrementMetric("mb_remember_total");

        sendJson(res, 200, {
          success: true,
          memory_id: duplicate.memoryId,
          scope: envelope.scope,
          type: envelope.type,
          deduped: true,
          dedup_reason: duplicate.reason,
          matched_id: duplicate.memoryId,
          score: Number(duplicate.score.toFixed(3)),
        });
        return;
      }

      const remembered = await runtime.intelligenceEngine.remember(
        envelope.content,
        envelope.type,
      );
      const memoryId =
        sanitizeText(remembered?.id, 128) ??
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      await persistMemoryMetadata(memoryId, envelope);
      incrementMetric("mb_remember_total");

      sendJson(res, 200, {
        success: true,
        memory_id: memoryId,
        scope: envelope.scope,
        type: envelope.type,
      });
    } catch (error) {
      // Log the underlying error to aid diagnostics without leaking internals to callers.
      const msg =
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : String(error);
      process.stderr.write(`[my-brain] remember error: ${msg}\n`);
      sendJson(res, 500, {
        success: false,
        error: "SERVER_ERROR",
        message: "failed to store memory",
      });
    }
    return;
  }

  if (method === "POST" && url === "/v1/memory/recall") {
    if (!allowRequest(req, "memory-recall")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory recall rate limit exceeded",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const query = sanitizeText(payload.query, 1024);
    if (!query) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "query must be a non-empty string",
      });
      return;
    }

    const topK = Math.min(
      Math.max(
        parseInteger(String(payload.top_k ?? payload.topK ?? "8"), 8),
        1,
      ),
      20,
    );
    const minScoreFromPayload = payload.min_score ?? payload.minScore;
    const minScore =
      typeof minScoreFromPayload === "number" &&
      minScoreFromPayload >= 0 &&
      minScoreFromPayload <= 1
        ? minScoreFromPayload
        : getDefaultRecallThreshold();

    if (!runtime.intelligenceEngine) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "memory engine unavailable",
      });
      return;
    }

    try {
      const recallStart = Date.now();
      const filters = {
        scope: sanitizeText(payload.scope, 16),
        repo: sanitizeText(payload.repo, 256),
        project: sanitizeText(payload.project, 128),
        language: sanitizeText(payload.language, 64),
        type: sanitizeText(payload.type, 32),
        tags: sanitizeTags(payload.tags),
        frameworks: Array.isArray(payload.frameworks)
          ? payload.frameworks
              .filter((value) => typeof value === "string")
              .map((value) => value.trim().toLowerCase())
              .slice(0, 8)
          : [],
        include_expired:
          payload.include_expired === true || payload.includeExpired === true,
        include_forgotten:
          payload.include_forgotten === true ||
          payload.includeForgotten === true,
        include_redacted:
          payload.include_redacted === true || payload.includeRedacted === true,
      };

      const candidateLimit = Math.min(Math.max(topK * 6, 30), 150);
      const queryEmbedding = await getCachedEmbedding(query);
      const candidates = await queryRecallCandidates(
        filters,
        candidateLimit,
        queryEmbedding,
      );
      const voteByMemoryId = await loadVoteBias(
        candidates.map((candidate) => String(candidate.memory_id)),
      );

      const scored = candidates.map(async (candidate) => {
        const content =
          typeof candidate.content === "string" ? candidate.content : "";
        const storedEmbedding = asVector(candidate.embedding);
        const contentEmbedding =
          storedEmbedding ?? (await getCachedEmbedding(content));
        const semanticScore = similarity(queryEmbedding, contentEmbedding);
        const lexicalScore = lexicalBoost(query, content);
        const votes = voteByMemoryId.get(String(candidate.memory_id)) ?? {
          up: 0,
          down: 0,
          bias: Number(candidate.vote_bias ?? 0),
        };
        const score = Math.max(
          0,
          Math.min(1, semanticScore + lexicalScore + Number(votes.bias ?? 0)),
        );

        return {
          id: candidate.memory_id,
          content,
          type: candidate.type,
          scope: candidate.scope,
          semantic_score: Number(semanticScore.toFixed(3)),
          lexical_score: Number(lexicalScore.toFixed(3)),
          vote_bias: Number(Number(votes.bias ?? 0).toFixed(3)),
          score,
          metadata: {
            repo: candidate.repo,
            repo_name: candidate.repo_name,
            project: candidate.project,
            language: candidate.language,
            frameworks: candidate.frameworks,
            tags: candidate.tags,
            created_at: candidate.created_at,
            expires_at: candidate.expires_at,
            forgotten_at: candidate.forgotten_at,
            redacted_at: candidate.redacted_at,
            use_count: candidate.use_count,
            last_seen_at: candidate.last_seen_at,
            votes_up: votes.up,
            votes_down: votes.down,
          },
        };
      });
      const resolved = await Promise.all(scored);
      const filtered = resolved
        .filter(
          (entry) => typeof entry.score === "number" && entry.score >= minScore,
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((entry) => ({
          ...entry,
          score: Number(entry.score.toFixed(3)),
        }));

      incrementMetric("mb_recall_total", {
        result: filtered.length > 0 ? "hit" : "miss",
      });
      observeDurationMs("mb_recall_latency_ms", Date.now() - recallStart);

      sendJson(res, 200, {
        success: true,
        query,
        top_k: topK,
        min_score: minScore,
        results: filtered,
      });
    } catch (error) {
      logInternalError("recall failure", error);
      sendJson(res, 500, {
        success: false,
        error: "SERVER_ERROR",
        message: "failed to recall memory",
      });
    }
    return;
  }

  if (method === "POST" && url === "/v1/memory/vote") {
    if (!allowRequest(req, "memory-vote")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory vote rate limit exceeded",
      });
      return;
    }

    if (!runtime.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "vote storage unavailable",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const memoryId = sanitizeText(payload.memory_id ?? payload.id, 128);
    const direction = sanitizeText(payload.direction, 8)?.toLowerCase();
    const reason = sanitizeText(payload.reason, 500);

    if (!memoryId || (direction !== "up" && direction !== "down")) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "memory_id and direction(up|down) are required",
      });
      return;
    }

    await runtime.pool.query(
      `INSERT INTO my_brain_memory_votes (memory_id, direction, reason, source)
       VALUES ($1, $2, $3, $4)`,
      [memoryId, direction, reason, "mb_vote"],
    );

    const voteStats = await runtime.pool.query(
      `SELECT
         SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END)::int AS up,
         SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END)::int AS down
       FROM my_brain_memory_votes
       WHERE memory_id = $1`,
      [memoryId],
    );
    const up = Number(voteStats.rows[0]?.up ?? 0);
    const down = Number(voteStats.rows[0]?.down ?? 0);
    const bias = voteBias(up, down);
    await runtime.pool.query(
      "UPDATE my_brain_memory_metadata SET vote_bias = $2 WHERE memory_id = $1",
      [memoryId, bias],
    );
    incrementMetric("mb_vote_total", { direction });

    sendJson(res, 200, {
      success: true,
      memory_id: memoryId,
      direction,
      vote_bias: bias,
      votes_up: up,
      votes_down: down,
    });
    return;
  }

  if (method === "POST" && url === "/v1/memory/forget") {
    if (!allowRequest(req, "memory-forget")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory forget rate limit exceeded",
      });
      return;
    }

    if (!runtime.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "metadata storage unavailable",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const memoryId = sanitizeText(payload.memory_id ?? payload.id, 128);
    const mode =
      sanitizeText(payload.mode, 8)?.toLowerCase() === "hard" ? "hard" : "soft";

    if (!memoryId) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "memory_id is required",
      });
      return;
    }

    if (mode === "hard") {
      await runtime.pool.query(
        "DELETE FROM my_brain_memory_metadata WHERE memory_id = $1",
        [memoryId],
      );
    } else {
      await runtime.pool.query(
        "UPDATE my_brain_memory_metadata SET forgotten_at = NOW() WHERE memory_id = $1",
        [memoryId],
      );
    }
    incrementMetric("mb_forget_total", { mode });

    sendJson(res, 200, {
      success: true,
      memory_id: memoryId,
      mode,
    });
    return;
  }

  if (method === "POST" && url === "/v1/session/open") {
    if (!runtime.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "session storage unavailable",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const sessionId = sanitizeText(payload.session_id, 128) ?? randomUUID();
    const agent = sanitizeText(payload.agent, 128) ?? "main";
    const context =
      typeof payload.context === "object" &&
      payload.context !== null &&
      !Array.isArray(payload.context)
        ? payload.context
        : buildProjectContext();

    await runtime.pool.query(
      `INSERT INTO my_brain_sessions (session_id, agent, context)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, agent, JSON.stringify(context)],
    );

    if (runtime.intelligenceEngine) {
      runtime.intelligenceEngine.beginTrajectory("session_open", "session");
      runtime.intelligenceEngine.setTrajectoryRoute(agent);
    }
    runtime.learning.sessionsOpened += 1;
    runtime.learning.currentRoute = agent;

    sendJson(res, 200, {
      success: true,
      session_id: sessionId,
      agent,
      route_confidence: runtime.learning.routeConfidence,
    });
    return;
  }

  if (method === "POST" && url === "/v1/session/close") {
    if (!runtime.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "session storage unavailable",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const sessionId = sanitizeText(payload.session_id, 128);
    if (!sessionId) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "session_id is required",
      });
      return;
    }

    const success = payload.success !== false;
    const quality =
      typeof payload.quality === "number" ? payload.quality : null;
    const reason = sanitizeText(payload.reason, 500);

    await runtime.pool.query(
      `UPDATE my_brain_sessions
       SET closed_at = NOW(), success = $2, quality = $3, reason = $4
       WHERE session_id = $1`,
      [sessionId, success, quality, reason],
    );

    if (runtime.intelligenceEngine) {
      runtime.intelligenceEngine.endTrajectory(success, quality ?? undefined);
    }
    runtime.learning.sessionsClosed += 1;
    if (success) {
      runtime.learning.successfulSessions += 1;
      runtime.learning.routeConfidence = Math.min(
        0.99,
        runtime.learning.routeConfidence + 0.05,
      );
    } else {
      runtime.learning.failedSessions += 1;
      runtime.learning.routeConfidence = Math.max(
        0.05,
        runtime.learning.routeConfidence - 0.05,
      );
    }
    if (typeof quality === "number") {
      runtime.learning.totalQuality += quality;
    }

    sendJson(res, 200, {
      success: true,
      session_id: sessionId,
      closed: true,
      route_confidence: Number(runtime.learning.routeConfidence.toFixed(3)),
    });
    return;
  }

  if (method === "POST" && url === "/v1/memory/digest") {
    if (!allowRequest(req, "memory-digest")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory digest rate limit exceeded",
      });
      return;
    }

    if (!runtime.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "digest storage unavailable",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const since = normalizeDigestSince(payload.since);
    const summary = await runtime.pool.query(
      `SELECT
        type,
        COALESCE(language, 'unknown') AS language,
        COALESCE(repo_name, 'unknown') AS repo_name,
        COUNT(*)::int AS count,
        COALESCE(
          SUM(
            CASE
              WHEN forgotten_at IS NULL
                   AND redacted_at IS NULL
                   AND (expires_at IS NULL OR expires_at > NOW())
              THEN 1 ELSE 0
            END
          ),
          0
        )::int AS active_count,
        COALESCE(SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= NOW() THEN 1 ELSE 0 END), 0)::int AS expired_count,
        COALESCE(SUM(CASE WHEN forgotten_at IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS forgotten_count,
        COALESCE(SUM(CASE WHEN redacted_at IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS redacted_count,
        COALESCE(SUM(use_count), 0)::int AS use_count,
        COALESCE(SUM(CASE WHEN vote_bias > 0 THEN 1 ELSE 0 END), 0)::int AS votes_up,
        COALESCE(SUM(CASE WHEN vote_bias < 0 THEN 1 ELSE 0 END), 0)::int AS votes_down
       FROM my_brain_memory_metadata
       WHERE created_at >= NOW() - $1::interval
       GROUP BY type, language, repo_name
       ORDER BY count DESC
       LIMIT 200`,
      [since],
    );

    sendJson(res, 200, {
      success: true,
      since,
      rows: summary.rows,
      learning: {
        sessions_opened: runtime.learning.sessionsOpened,
        sessions_closed: runtime.learning.sessionsClosed,
        successful_sessions: runtime.learning.successfulSessions,
        failed_sessions: runtime.learning.failedSessions,
        route: runtime.learning.currentRoute,
        route_confidence: Number(runtime.learning.routeConfidence.toFixed(3)),
      },
    });
    return;
  }

  if (method === "POST" && url === "/v1/memory/backfill") {
    if (!allowRequest(req, "memory-backfill")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory backfill rate limit exceeded",
      });
      return;
    }

    if (!runtime.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "metadata storage unavailable",
      });
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const batchSize = Math.min(
      Math.max(parseInteger(String(payload.batch_size ?? "200"), 200), 1),
      1000,
    );
    const result = await backfillMemoryMetadata(batchSize);

    sendJson(res, 200, {
      success: true,
      batch_size: batchSize,
      ...result,
    });
    return;
  }

  sendJson(res, 404, {
    error: "not_found",
    message: "Route not implemented in bootstrap orchestrator",
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    logInternalError("request handler failure", error);
    sendJson(res, 500, {
      success: false,
      error: "SERVER_ERROR",
      message: "unhandled orchestrator error",
    });
  });
});

initializeRuntime()
  .catch((error) => {
    pushDegradedReason("runtime initialization threw");
    logInternalError("runtime initialization failed", error);
  })
  .finally(() => {
    server.listen(config.vectorPort, "0.0.0.0", () => {
      process.stdout.write(
        `[my-brain] orchestrator listening on :${config.vectorPort} mode=${config.mode} log=${config.logLevel}\n`,
      );
    });
  });
