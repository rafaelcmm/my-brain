/**
 * Orchestrator bootstrap: assembles all subsystems, wires the HTTP server, and
 * begins accepting traffic.
 *
 * Startup sequence:
 *  1. Load config from env
 *  2. Validate auth token
 *  3. Initialize Postgres (pool + schemas)
 *  4. Initialize intelligence engine (ruvector)
 *  5. Initialize LLM runtime (ruvllm)
 *  6. Record initializedAt timestamp
 *  7. Initialize embedding provider (Ollama warmup)
 *  8. Evaluate engine readiness flag
 *  9. Start HTTP server (regardless of subsystem failures for graceful degraded mode)
 *
 * Degraded mode: individual subsystem failures are recorded in
 * `state.degradedReasons` but do not halt startup. The /health and /ready
 * endpoints expose the degradation state to clients.
 */

import http from "node:http";
import { loadConfig, parseInteger } from "../config/load-config.js";
import { validateAuthToken } from "../policies/auth.js";
import { pushDegradedReason } from "../observability/log.js";
import { logInternalError } from "../observability/log.js";
import { initializeDatabase } from "../infrastructure/postgres.js";
import {
  initializeIntelligenceEngine,
  initializeLlmRuntime,
} from "../infrastructure/intelligence.js";
import {
  embedText as rawEmbedText,
  getCachedEmbedding as rawGetCachedEmbedding,
  initializeEmbeddingProvider,
} from "../infrastructure/embedding.js";
import {
  backfillMemoryMetadata,
  type BackfillResult,
} from "../application/backfill.js";
import { createInitialRuntimeState } from "./runtime.js";
import { handleRequest } from "../http/router.js";

const config = loadConfig();

/**
 * Maximum accepted request body size derived from env with 1 MiB default.
 * Enforced by parseJsonBody to prevent memory exhaustion.
 */
const MAX_REQUEST_BODY_BYTES = parseInteger(
  process.env["MYBRAIN_MAX_REQUEST_BODY_BYTES"],
  1_048_576,
);

/** LRU embedding cache shared across all request handlers. */
const embeddingCache = new Map<string, number[]>();

/** Maximum entries before the oldest embedding is evicted from the cache. */
const MAX_EMBEDDING_CACHE_SIZE = 400;

/** Mutable runtime state assembled by initializeRuntime and read by all routes. */
const state = createInitialRuntimeState(config.embeddingDim);

/**
 * Records a degradation reason once — delegates to the shared log helper so
 * the array dedup logic lives in one place.
 *
 * @param reason - Human-readable degradation reason.
 */
function degraded(reason: string): void {
  pushDegradedReason(state.degradedReasons, reason);
}

/**
 * Logs internal errors without exposing stack traces to callers.
 *
 * @param context - Stable operation label for log correlation.
 * @param error - Caught error value.
 */
function log(context: string, error: unknown): void {
  logInternalError(context, error, config.logLevel);
}

/**
 * Embed function bound to the current runtime embedding state and config.
 * Passed into the router context so handlers never read module globals directly.
 *
 * @param content - Text to embed.
 * @returns Embedding vector.
 */
function embedText(content: string): Promise<number[]> {
  return rawEmbedText(
    content,
    state.embedding,
    { llmUrl: config.llmUrl, embeddingModel: config.embeddingModel },
    state.intelligenceEngine,
  );
}

/**
 * LRU-cached embed function delegating to rawGetCachedEmbedding.
 *
 * @param content - Text to embed.
 * @returns Cached or freshly computed embedding vector.
 */
function getCachedEmbedding(content: string): Promise<number[]> {
  return rawGetCachedEmbedding(
    content,
    embeddingCache,
    MAX_EMBEDDING_CACHE_SIZE,
    embedText,
  );
}

/**
 * Backfill function bound to the current pool and getCachedEmbedding.
 * Returns early with zero counts when the pool is not available.
 *
 * @param batchSize - Maximum rows to process in this run.
 * @returns Backfill result counters.
 */
async function backfill(batchSize: number): Promise<BackfillResult> {
  if (!state.pool) {
    return { processed: 0, updated: 0 };
  }
  return backfillMemoryMetadata(state.pool, batchSize, getCachedEmbedding);
}

/**
 * Executes the full subsystem initialization sequence before the server
 * accepts traffic.
 *
 * Each subsystem updates the shared `state` in place. Failures are caught
 * and recorded as degradation reasons rather than aborting the process.
 */
async function initializeRuntime(): Promise<void> {
  if (!config.internalApiKey) {
    throw new Error("MYBRAIN_INTERNAL_API_KEY is required");
  }

  // validateAuthToken returns false when the token is too short; record degradation.
  if (!validateAuthToken(config, state.degradedReasons)) {
    degraded("orchestrator token validation failed");
  }

  // Postgres: pool creation + schema bootstrap
  const pool = await initializeDatabase(
    { dbUrl: config.dbUrl, embeddingDim: config.embeddingDim },
    state.db,
    degraded,
  );
  if (pool) {
    state.pool = pool;
  }

  // Intelligence engine: ruvector embed + SONA
  state.intelligenceEngine = initializeIntelligenceEngine(
    {
      embeddingDim: config.embeddingDim,
      sonaEnabled: config.sonaEnabled,
      llmModel: config.llmModel,
    },
    state.engine,
    degraded,
  );

  // LLM runtime: ruvllm instance
  state.llmEngine = initializeLlmRuntime(
    {
      embeddingDim: config.embeddingDim,
      sonaEnabled: config.sonaEnabled,
      llmModel: config.llmModel,
    },
    state.llm,
    degraded,
  );

  state.initializedAt = new Date().toISOString();

  // Embedding provider: Ollama warmup, updates state.embedding and state.engine.embeddingDim
  await initializeEmbeddingProvider(
    { llmUrl: config.llmUrl, embeddingModel: config.embeddingModel },
    state.embedding,
    state.engine,
    degraded,
  );

  // Engine readiness tracks memory operations capability. Embedding warmup can
  // fail independently while intelligence-engine embeddings still work.
  state.engine.loaded =
    state.db.connected &&
    state.db.adrSchemasReady &&
    Boolean(state.intelligenceEngine);

  if (!state.engine.loaded) {
    degraded("engine warmup incomplete");
  }
}

// ── HTTP server ────────────────────────────────────────────────────────────────

/** Router context injected into every request handled by handleRequest. */
const routerCtx = {
  config,
  state,
  maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
  embedText,
  getCachedEmbedding,
  backfill,
};

const server = http.createServer((req, res) => {
  handleRequest(req, res, routerCtx).catch((error) => {
    log("request handler failure", error);
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        success: false,
        error: "SERVER_ERROR",
        message: "unhandled orchestrator error",
      }),
    );
  });
});

initializeRuntime()
  .catch((error) => {
    degraded("runtime initialization threw");
    log("runtime initialization failed", error);
  })
  .finally(() => {
    server.listen(config.vectorPort, "0.0.0.0", () => {
      process.stdout.write(
        `[my-brain] orchestrator listening on :${config.vectorPort} mode=${config.mode} log=${config.logLevel}\n`,
      );
    });
  });
