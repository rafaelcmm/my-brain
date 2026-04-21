import http from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
const MIN_TOKEN_LENGTH = parseInteger(process.env.MYBRAIN_MIN_TOKEN_LENGTH, 73);
const MAX_REQUEST_BODY_BYTES = parseInteger(
  process.env.MYBRAIN_MAX_REQUEST_BODY_BYTES,
  1048576,
);

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
 * Normalizes repository selectors across URL and short-name forms.
 *
 * @param {string | null} value Raw repository selector.
 * @returns {string[]} Ordered selector variants for SQL matching.
 */
function normalizeRepoSelector(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  const raw = value.trim();
  if (!raw) {
    return [];
  }

  const normalized = raw
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    // Rewrite scp-like git remotes only: git@host:org/repo -> host/org/repo
    .replace(/^([^/]+):(.+)$/, "$1/$2")
    .replace(/\.git$/, "")
    .toLowerCase();
  const basename = normalized.split("/").filter(Boolean).pop() ?? normalized;

  return Array.from(new Set([raw, normalized, basename]));
}

/**
 * Generates stable content fingerprint for dedup candidate bucketing.
 *
 * @param {string} content Memory content.
 * @returns {string} SHA1 digest for normalized content.
 */
function contentFingerprint(content) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha1").update(normalized).digest("hex");
}

/**
 * Converts unknown DB payload into numeric embedding vector.
 *
 * @param {unknown} value Candidate vector payload.
 * @returns {number[] | null} Parsed vector or null when unusable.
 */
function asVector(value) {
  if (Array.isArray(value)) {
    const converted = value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    return converted.length > 0 ? converted : null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return asVector(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Computes bounded vote bias used to nudge ranking without overpowering semantics.
 *
 * @param {number} up Up-vote count.
 * @param {number} down Down-vote count.
 * @returns {number} Ranking adjustment in range [-0.15, 0.15].
 */
function voteBias(up, down) {
  const total = up + down;
  if (total <= 0) {
    return 0;
  }

  const raw = Math.tanh((up - down) / Math.max(1, total)) * 0.15;
  return Number(raw.toFixed(3));
}

/**
 * Computes simple lexical overlap boost for degraded semantic edge-cases.
 *
 * @param {string} query Search query text.
 * @param {string} content Candidate content text.
 * @returns {number} Boost in range [0, 0.3].
 */
function lexicalBoost(query, content) {
  const normalize = (value) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3);

  const queryTokens = new Set(normalize(query));
  const contentTokens = new Set(normalize(content));
  if (queryTokens.size === 0 || contentTokens.size === 0) {
    return 0;
  }

  let hits = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      hits += 1;
    }
  }

  const ratio = hits / queryTokens.size;
  return Number(Math.min(0.3, ratio * 0.3).toFixed(3));
}

/**
 * Computes cosine similarity between two vectors.
 *
 * @param {number[]} a First embedding vector.
 * @param {number[]} b Second embedding vector.
 * @returns {number} Similarity score in range [-1, 1].
 */
function similarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const av = Number(a[index] ?? 0);
    const bv = Number(b[index] ?? 0);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / Math.sqrt(normA * normB);
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

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { valid: false, errors: ["payload must be an object"] };
  }

  const body = /** @type {Record<string, unknown>} */ (payload);
  const content = sanitizeText(body.content, 8192);
  if (!content) {
    errors.push("content must be a non-empty string");
  }

  const type = sanitizeText(body.type, 32)?.toLowerCase();
  if (!type || !MEMORY_TYPES.has(type)) {
    errors.push(
      "type must be one of: decision, fix, convention, gotcha, tradeoff, pattern, reference",
    );
  }

  const scope = sanitizeText(body.scope, 16)?.toLowerCase();
  if (!scope || !MEMORY_SCOPES.has(scope)) {
    errors.push("scope must be one of: repo, project, global");
  }

  const metadataRaw =
    typeof body.metadata === "object" &&
    body.metadata !== null &&
    !Array.isArray(body.metadata)
      ? /** @type {Record<string, unknown>} */ (body.metadata)
      : {};

  const confidence = metadataRaw.confidence;
  if (
    confidence !== undefined &&
    (typeof confidence !== "number" ||
      Number.isNaN(confidence) ||
      confidence < 0 ||
      confidence > 1)
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
 * embeddingModel: string,
 * embeddingDim: number,
 * vectorPort: number,
 * sonaEnabled: boolean,
 * tokenFile: string,
 * internalApiKey: string,
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
    embeddingModel:
      (process.env.MYBRAIN_EMBEDDING_MODEL || "qwen3-embedding:0.6b").trim() ||
      "qwen3-embedding:0.6b",
    embeddingDim: parseInteger(process.env.MYBRAIN_EMBEDDING_DIM, 1024),
    vectorPort: parseInteger(process.env.RUVECTOR_PORT, 8080),
    sonaEnabled: parseBoolean(process.env.RUVLLM_SONA_ENABLED, true),
    tokenFile: process.env.MYBRAIN_AUTH_TOKEN_FILE ?? "/run/secrets/auth-token",
    internalApiKey: process.env.MYBRAIN_INTERNAL_API_KEY ?? "",
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
const rateLimitPerWindow = parseInteger(
  process.env.MYBRAIN_RATE_LIMIT_PER_MIN,
  60,
);
const rateBuckets = new Map();
const embeddingCache = new Map();
const maxEmbeddingCacheSize = 400;
const metricsCounters = new Map();
const metricsHistograms = new Map();
const bridgeCapabilitiesCacheMs = 10_000;

/**
 * Increments in-memory metric counter with optional static labels.
 *
 * @param {string} name Metric name.
 * @param {Record<string, string>} [labels] Optional label map.
 * @param {number} [delta] Increment amount.
 * @returns {void}
 */
function incrementMetric(name, labels = {}, delta = 1) {
  const labelEntries = Object.entries(labels).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const suffix = labelEntries
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const key = suffix ? `${name}|${suffix}` : name;
  const current = metricsCounters.get(key) ?? 0;
  metricsCounters.set(key, current + delta);
}

/**
 * Observes duration values in milliseconds for fixed-bucket histograms.
 *
 * @param {string} name Metric name.
 * @param {number} valueMs Observed latency in milliseconds.
 * @returns {void}
 */
function observeDurationMs(name, valueMs) {
  const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  const existing = metricsHistograms.get(name) ?? {
    buckets,
    counts: new Array(buckets.length).fill(0),
    sum: 0,
    total: 0,
  };

  for (let index = 0; index < existing.buckets.length; index += 1) {
    if (valueMs <= existing.buckets[index]) {
      existing.counts[index] += 1;
    }
  }
  existing.sum += valueMs;
  existing.total += 1;
  metricsHistograms.set(name, existing);
}

/**
 * Renders metrics in Prometheus text exposition format.
 *
 * @returns {string} Text payload consumable by Prometheus scrapers.
 */
function renderMetrics() {
  const lines = [];

  for (const [key, value] of metricsCounters.entries()) {
    const [name, rawLabels] = key.split("|");
    if (rawLabels) {
      const labels = rawLabels
        .split(",")
        .map((entry) => entry.split("="))
        .map(([labelKey, labelValue]) => `${labelKey}="${labelValue}"`)
        .join(",");
      lines.push(`${name}{${labels}} ${value}`);
    } else {
      lines.push(`${name} ${value}`);
    }
  }

  for (const [name, histogram] of metricsHistograms.entries()) {
    for (let index = 0; index < histogram.buckets.length; index += 1) {
      lines.push(
        `${name}_bucket{le="${histogram.buckets[index]}"} ${histogram.counts[index]}`,
      );
    }
    lines.push(`${name}_bucket{le="+Inf"} ${histogram.total}`);
    lines.push(`${name}_sum ${histogram.sum}`);
    lines.push(`${name}_count ${histogram.total}`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Applies fixed-window rate limiting by endpoint class and caller address.
 *
 * @param {http.IncomingMessage} req Incoming request.
 * @param {string} endpointKey Endpoint class key.
 * @returns {boolean} True when request can proceed.
 */
function allowRequest(req, endpointKey) {
  const caller =
    sanitizeText(req.headers["x-forwarded-for"], 128) ??
    sanitizeText(req.socket?.remoteAddress, 128) ??
    "unknown";
  const now = Date.now();
  const bucketKey = `${endpointKey}:${caller}`;
  const entry = rateBuckets.get(bucketKey);

  if (!entry || now - entry.windowStart >= rateWindowMs) {
    rateBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= rateLimitPerWindow) {
    return false;
  }

  entry.count += 1;
  rateBuckets.set(bucketKey, entry);
  return true;
}

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
 * Converts internal runtime errors into non-sensitive status labels.
 *
 * @param {string | null} errorMessage Internal error string.
 * @returns {string | null} Safe status value.
 */
function sanitizeStatusError(errorMessage) {
  if (!errorMessage) {
    return null;
  }

  return "unavailable";
}

/**
 * Logs failures without exposing internal details outside debug mode.
 *
 * @param {string} context Stable operation context.
 * @param {unknown} error Caught error object.
 * @returns {void}
 */
function logInternalError(context, error) {
  if (config.logLevel === "debug") {
    process.stderr.write(
      `[my-brain] ${context}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    return;
  }

  process.stderr.write(`[my-brain] ${context}: internal error\n`);
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
      content_sha1 TEXT,
      embedding JSONB,
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
      forgotten_at TIMESTAMPTZ,
      redacted_at TIMESTAMPTZ,
      use_count INTEGER NOT NULL DEFAULT 1,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confidence DOUBLE PRECISION,
      vote_bias DOUBLE PRECISION NOT NULL DEFAULT 0,
      visibility TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS content_sha1 TEXT",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS embedding JSONB",
  );
  await pool.query(
    `ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS embedding_vector ruvector(${config.embeddingDim})`,
  );
  await pool.query(
    `ALTER TABLE my_brain_memory_metadata ALTER COLUMN embedding_vector TYPE ruvector(${config.embeddingDim}) USING CASE WHEN embedding_vector IS NULL THEN NULL ELSE (embedding_vector::text)::ruvector(${config.embeddingDim}) END`,
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS forgotten_at TIMESTAMPTZ",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 1",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS vote_bias DOUBLE PRECISION NOT NULL DEFAULT 0",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_sha1_scope ON my_brain_memory_metadata(content_sha1, scope)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_repo ON my_brain_memory_metadata(repo, repo_name)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_embedding_hnsw ON my_brain_memory_metadata USING hnsw (embedding_vector ruvector_cosine_ops)",
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_brain_memory_votes (
      id BIGSERIAL PRIMARY KEY,
      memory_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      reason TEXT,
      source TEXT,
      voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_brain_sessions (
      session_id TEXT PRIMARY KEY,
      agent TEXT,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      success BOOLEAN,
      quality DOUBLE PRECISION,
      reason TEXT
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
    runtime.engine.embeddingDim = Number(
      stats?.memoryDimensions ?? config.embeddingDim,
    );
  } catch (error) {
    runtime.engine.error =
      error instanceof Error ? error.message : String(error);
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
 * Validates auth token meets security requirements before allowing startup.
 *
 * @returns {boolean} True when token validation succeeds.
 */
function validateAuthToken() {
  if (!fs.existsSync(config.tokenFile)) {
    pushDegradedReason("auth token file missing for orchestrator");
    return false;
  }

  let token;
  try {
    token = fs.readFileSync(config.tokenFile, "utf8").trim();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "EACCES") {
      // EACCES means the token file exists but the orchestrator's non-root user
      // cannot read it (mode 0444/0600 with a different owner).  When
      // MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true, the operator explicitly asserts that
      // the Caddy gateway is the sole auth enforcement point and leaked token
      // access is not a concern.  Default is false-closed so a misconfigured
      // mount does not silently open an unauthenticated path.
      const gatewayOnlyAuth = parseBoolean(
        process.env.MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH,
        false,
      );
      if (gatewayOnlyAuth) {
        process.stdout.write(
          "[my-brain] auth token file not readable by orchestrator user; MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true — relying on gateway auth enforcement\n",
        );
        return true;
      }
      pushDegradedReason(
        "auth token file not readable by orchestrator user; set MYBRAIN_ALLOW_GATEWAY_ONLY_AUTH=true to allow gateway-only auth",
      );
      return false;
    }

    pushDegradedReason("auth token unreadable by orchestrator runtime");
    return false;
  }

  if (token.length < MIN_TOKEN_LENGTH) {
    pushDegradedReason("auth token length below policy");
    return false;
  }

  if (!token.startsWith("my-brain-")) {
    pushDegradedReason("auth token prefix invalid");
    return false;
  }

  process.stdout.write(
    `[my-brain] auth token validated (${token.length} chars)\n`,
  );
  return true;
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
  if (!config.llmUrl) {
    runtime.embedding.error = "MYBRAIN_LLM_URL not configured";
    pushDegradedReason("embedding provider url missing");
    return;
  }

  try {
    const response = await fetch(`${config.llmUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.embeddingModel,
        prompt: "my-brain warmup",
      }),
    });

    if (!response.ok) {
      throw new Error(`embedding warmup failed: ${response.status}`);
    }

    const body = await response.json();
    const vector = asVector(body.embedding);
    if (!vector || vector.length === 0) {
      throw new Error("embedding response missing vector");
    }

    runtime.embedding.ready = true;
    runtime.embedding.provider = "ollama";
    runtime.embedding.dim = vector.length;
    runtime.engine.embeddingDim = vector.length;
  } catch (error) {
    runtime.embedding.error =
      error instanceof Error ? error.message : String(error);
    pushDegradedReason("embedding warmup failed");
  }
}

/**
 * Computes embedding vector with Ollama provider and deterministic fallback.
 *
 * @param {string} content Source text to embed.
 * @returns {Promise<number[]>} Embedding vector.
 */
async function embedText(content) {
  if (runtime.embedding.ready) {
    const response = await fetch(`${config.llmUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.embeddingModel,
        prompt: content,
      }),
    });
    if (response.ok) {
      const body = await response.json();
      const vector = asVector(body.embedding);
      if (vector && vector.length > 0) {
        return vector;
      }
    }
  }

  if (runtime.intelligenceEngine) {
    return runtime.intelligenceEngine.embed(content);
  }

  throw new Error("embedding engine unavailable");
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
 * @returns {Promise<Array<Record<string, unknown>>>} Candidate metadata rows.
 */
async function queryRecallCandidates(filters, limit, queryEmbedding = null) {
  if (!runtime.pool) {
    return [];
  }

  const clauses = ["1 = 1"];
  const values = [];

  const pushValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (typeof filters.scope === "string") {
    clauses.push(`scope = ${pushValue(filters.scope)}`);
  }

  if (typeof filters.repo === "string") {
    const variants = normalizeRepoSelector(filters.repo);
    if (variants.length > 0) {
      clauses.push(
        `(repo = ANY(${pushValue(variants)}::text[]) OR repo_name = ANY(${pushValue(variants)}::text[]))`,
      );
    }
  }

  if (typeof filters.project === "string") {
    clauses.push(`project = ${pushValue(filters.project)}`);
  }

  if (typeof filters.language === "string") {
    clauses.push(`language = ${pushValue(filters.language)}`);
  }

  if (typeof filters.type === "string") {
    clauses.push(`type = ${pushValue(filters.type)}`);
  }

  if (!filters.include_expired) {
    clauses.push("(expires_at IS NULL OR expires_at > NOW())");
  }

  if (!filters.include_forgotten) {
    clauses.push("forgotten_at IS NULL");
  }

  if (!filters.include_redacted) {
    clauses.push("redacted_at IS NULL");
  }

  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(tags) AS tag
        WHERE tag = ANY(${pushValue(filters.tags)}::text[])
      )`,
    );
  }

  if (Array.isArray(filters.frameworks) && filters.frameworks.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(frameworks) AS framework
        WHERE framework = ANY(${pushValue(filters.frameworks)}::text[])
      )`,
    );
  }

  const embeddingLiteral =
    Array.isArray(queryEmbedding) && queryEmbedding.length > 0
      ? JSON.stringify(queryEmbedding)
      : null;
  let orderBy = "created_at DESC";

  if (embeddingLiteral) {
    // Prefer ANN-friendly ordering for rows that already carry vector payload,
    // then fall back to recency for legacy rows that still need backfill.
    orderBy = `
      CASE WHEN embedding_vector IS NULL THEN 1 ELSE 0 END,
      embedding_vector <=> ${pushValue(embeddingLiteral)}::ruvector,
      created_at DESC`;
  }

  values.push(limit);

  const result = await runtime.pool.query(
    `SELECT
      memory_id,
      content,
      content_sha1,
      type,
      scope,
      repo,
      repo_name,
      project,
      language,
      frameworks,
      tags,
      embedding,
      embedding_vector,
      vote_bias,
      use_count,
      last_seen_at,
      forgotten_at,
      redacted_at,
      created_at,
      expires_at
    FROM my_brain_memory_metadata
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $${values.length}`,
    values,
  );

  return result.rows;
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

  const metadata = /** @type {Record<string, unknown>} */ (
    envelope.metadata ?? {}
  );
  const normalizedRepo =
    sanitizeText(metadata.repo, 256) ?? sanitizeText(metadata.repo_name, 128);
  const threshold = runtime.embedding.ready ? 0.6 : 0.85;
  const semanticThreshold = 0.95;
  const fingerprint = contentFingerprint(envelope.content);

  const candidates = await queryRecallCandidates(
    {
      scope: envelope.scope,
      type: envelope.type,
      repo: normalizedRepo,
      include_expired: false,
      include_forgotten: false,
      include_redacted: false,
    },
    50,
  );

  let bestFingerprint = null;
  let bestSemantic = null;
  for (const candidate of candidates) {
    const candidateEmbedding = asVector(candidate.embedding);
    if (!candidateEmbedding) {
      continue;
    }

    const score = similarity(embedding, candidateEmbedding);
    if (candidate.content_sha1 === fingerprint && score >= threshold) {
      if (!bestFingerprint || score > bestFingerprint.score) {
        bestFingerprint = {
          memoryId: String(candidate.memory_id),
          score,
          reason: "fingerprint",
        };
      }
    }

    if (score >= semanticThreshold) {
      if (!bestSemantic || score > bestSemantic.score) {
        bestSemantic = {
          memoryId: String(candidate.memory_id),
          score,
          reason: "semantic",
        };
      }
    }
  }

  return bestFingerprint ?? bestSemantic;
}

/**
 * Loads aggregate vote counts and computed bias for memory ids.
 *
 * @param {string[]} memoryIds Memory ids in current recall page.
 * @returns {Promise<Map<string, {up: number, down: number, bias: number}>>} Vote aggregates.
 */
async function loadVoteBias(memoryIds) {
  const result = new Map();
  if (!runtime.pool || memoryIds.length === 0) {
    return result;
  }

  const queryResult = await runtime.pool.query(
    `SELECT memory_id,
        SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END)::int AS up,
        SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END)::int AS down
     FROM my_brain_memory_votes
     WHERE memory_id = ANY($1::text[])
     GROUP BY memory_id`,
    [memoryIds],
  );

  for (const row of queryResult.rows) {
    const up = Number(row.up ?? 0);
    const down = Number(row.down ?? 0);
    result.set(String(row.memory_id), {
      up,
      down,
      bias: voteBias(up, down),
    });
  }

  return result;
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
  // Security boundary: callers must pass hardcoded git arguments only.
  try {
    const output = execFileSync("git", args, {
      cwd,
      timeout: 2000,
      maxBuffer: 16 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();

    return output || null;
  } catch {
    return null;
  }
}

/**
 * Retrieves cached embedding for repeated recall scoring.
 *
 * @param {string} content Memory content string.
 * @returns {Promise<number[]>} Embedding vector.
 */
async function getCachedEmbedding(content) {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  const cacheKey = createHash("sha1").update(normalized).digest("hex");

  if (embeddingCache.has(cacheKey)) {
    const cached = embeddingCache.get(cacheKey);
    embeddingCache.delete(cacheKey);
    embeddingCache.set(cacheKey, cached);
    return cached;
  }

  const embedding = await embedText(content);
  embeddingCache.set(cacheKey, embedding);

  if (embeddingCache.size > maxEmbeddingCacheSize) {
    const oldestKey = embeddingCache.keys().next().value;
    embeddingCache.delete(oldestKey);
  }

  return embedding;
}

/**
 * Converts common git URL formats into normalized repo and short repo_name.
 *
 * @param {string | null} remoteUrl Git remote URL candidate.
 * @returns {{repo: string | null, repo_name: string | null}} Normalized identifiers.
 */
function parseRemoteRepo(remoteUrl) {
  if (!remoteUrl) {
    return { repo: null, repo_name: null };
  }

  const normalized = remoteUrl
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/^([^/]+):(.+)$/, "$1/$2")
    .replace(/\.git$/, "");

  const parts = normalized.split("/").filter(Boolean);
  const repoName = parts.length > 0 ? parts[parts.length - 1] : null;

  return {
    repo: normalized,
    repo_name: repoName,
  };
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

  const metadata = /** @type {Record<string, unknown>} */ (
    envelope.metadata ?? {}
  );
  const frameworks = Array.isArray(metadata.frameworks)
    ? metadata.frameworks
    : [];
  const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
  const fingerprint = contentFingerprint(envelope.content);
  const embedding = asVector(metadata.embedding);
  const useCount =
    typeof metadata.use_count === "number" &&
    Number.isInteger(metadata.use_count)
      ? Math.max(metadata.use_count, 1)
      : 1;

  await runtime.pool.query(
    `INSERT INTO my_brain_memory_metadata (
      memory_id,
      content,
      content_sha1,
      embedding,
      embedding_vector,
      type,
      scope,
      repo,
      repo_name,
      project,
      language,
      frameworks,
      path,
      symbol,
      tags,
      source,
      author,
      agent,
      created_at,
      expires_at,
      forgotten_at,
      redacted_at,
      use_count,
      last_seen_at,
      confidence,
      vote_bias,
      visibility,
      metadata
    ) VALUES (
      $1, $2, $3, $4::jsonb, $5::ruvector, $6, $7, $8, $9, $10,
      $11, $12::jsonb, $13, $14, $15::jsonb, $16, $17, $18,
      COALESCE($19::timestamptz, NOW()), $20::timestamptz, $21::timestamptz,
      $22::timestamptz, $23, COALESCE($24::timestamptz, NOW()), $25, $26, $27, $28::jsonb
    )
    ON CONFLICT (memory_id) DO UPDATE SET
      content = EXCLUDED.content,
      content_sha1 = EXCLUDED.content_sha1,
      embedding = EXCLUDED.embedding,
      embedding_vector = EXCLUDED.embedding_vector,
      type = EXCLUDED.type,
      scope = EXCLUDED.scope,
      repo = EXCLUDED.repo,
      repo_name = EXCLUDED.repo_name,
      project = EXCLUDED.project,
      language = EXCLUDED.language,
      frameworks = EXCLUDED.frameworks,
      path = EXCLUDED.path,
      symbol = EXCLUDED.symbol,
      tags = EXCLUDED.tags,
      source = EXCLUDED.source,
      author = EXCLUDED.author,
      agent = EXCLUDED.agent,
      created_at = EXCLUDED.created_at,
      expires_at = EXCLUDED.expires_at,
      forgotten_at = EXCLUDED.forgotten_at,
      redacted_at = EXCLUDED.redacted_at,
      use_count = EXCLUDED.use_count,
      last_seen_at = EXCLUDED.last_seen_at,
      confidence = EXCLUDED.confidence,
      vote_bias = EXCLUDED.vote_bias,
      visibility = EXCLUDED.visibility,
      metadata = EXCLUDED.metadata`,
    [
      memoryId,
      envelope.content,
      fingerprint,
      JSON.stringify(embedding ?? []),
      embedding && embedding.length > 0 ? JSON.stringify(embedding) : null,
      envelope.type,
      envelope.scope,
      metadata.repo,
      metadata.repo_name,
      metadata.project,
      metadata.language,
      JSON.stringify(frameworks),
      metadata.path,
      metadata.symbol,
      JSON.stringify(tags),
      metadata.source,
      metadata.author,
      metadata.agent,
      metadata.created_at,
      metadata.expires_at,
      metadata.forgotten_at,
      metadata.redacted_at,
      useCount,
      metadata.last_seen_at,
      metadata.confidence,
      typeof metadata.vote_bias === "number" ? metadata.vote_bias : 0,
      metadata.visibility,
      JSON.stringify(metadata),
    ],
  );
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
  if (!config.internalApiKey) {
    return false;
  }

  const header = req.headers["x-mybrain-internal-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (typeof provided !== "string") {
    return false;
  }

  const expected = Buffer.from(config.internalApiKey, "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
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
