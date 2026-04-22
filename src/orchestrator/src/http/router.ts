/**
 * HTTP request router for all orchestrator API endpoints.
 *
 * All business logic is imported from domain/application/infrastructure modules.
 * handleRequest is a pure dispatcher: it authenticates, delegates to handlers,
 * and returns JSON. It carries no module-level state of its own.
 *
 * Route catalogue:
 *   GET  /health                      — liveness + capabilities
 *   GET  /ready                       — dependency readiness gate
 *   GET  /v1/status                   — full runtime status
 *   GET  /v1/capabilities             — feature flags + embedding info
 *   GET  /v1/learning/stats           — SONA learning counters
 *   GET  /metrics                     — Prometheus text exposition
 *   POST /v1/context/probe            — project context detection
 *   POST /v1/memory                   — capture + dedup + embed
 *   POST /v1/memory/recall            — vector + lexical recall
 *   POST /v1/memory/vote              — up/down vote + bias update
 *   POST /v1/memory/forget            — soft (forgotten_at) or hard delete
 *   POST /v1/session/open             — begin SONA learning trajectory
 *   POST /v1/session/close            — end SONA learning trajectory
 *   POST /v1/memory/digest            — aggregate stats summary
 *   POST /v1/memory/backfill          — heal legacy rows
 */

import type http from "node:http";
import { randomUUID } from "node:crypto";
import { sendJson } from "./response.js";
import { parseJsonBody } from "./body.js";
import { allowRequest } from "../policies/rate-limit.js";
import { hasValidInternalKey } from "../policies/auth.js";
import {
  incrementMetric,
  observeDurationMs,
  renderMetrics,
} from "../observability/metrics.js";
import { logInternalError, sanitizeStatusError } from "../observability/log.js";
import { type loadConfig, parseInteger } from "../config/load-config.js";
import {
  sanitizeTags,
  sanitizeText,
  validateMemoryEnvelope,
} from "../domain/memory-validation.js";
import { asVector } from "../domain/fingerprint.js";
import { lexicalBoost, similarity, voteBias } from "../domain/scoring.js";
import {
  findDuplicateMemory,
  loadVoteBias,
  persistMemoryMetadata,
  queryRecallCandidates,
} from "../infrastructure/postgres-memory.js";

/** Inferred config shape from loadConfig return value. */
type OrchestratorConfig = ReturnType<typeof loadConfig>;

/** Shape expected by allowRequest's socket parameter. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Adapts a Node.js IncomingMessage to the shape accepted by allowRequest.
 * remoteAddress is widened from `string | undefined` to `string | null | undefined`
 * by the rate-limit module's socket type.
 */
function asRateLimitReq(req: http.IncomingMessage): AllowRequestReq {
  return req as unknown as AllowRequestReq;
}
import type { RuntimeState } from "../bootstrap/runtime.js";
import type { BackfillResult } from "../application/backfill.js";
import { normalizeDigestSince } from "../application/backfill.js";
import type { ProjectContextHints } from "../application/project-context.js";
import { buildProjectContext } from "../application/project-context.js";

/**
 * Capabilities payload derived from runtime state.
 * Used by /health, /ready, and /v1/capabilities routes.
 */
export interface Capabilities {
  engine: boolean;
  vectorDb: boolean;
  sona: boolean;
  attention: boolean;
  embeddingDim: number;
}

/**
 * Derives current capability flags from the runtime state.
 *
 * @param state - Current runtime state.
 * @returns Capability flags used by health and capabilities routes.
 */
export function getCapabilities(state: RuntimeState): Capabilities {
  const vectorReady = state.db.connected && state.db.adrSchemasReady;
  const engineReady = state.engine.loaded && state.embedding.ready;
  return {
    engine: engineReady,
    vectorDb: vectorReady,
    sona: state.engine.sona,
    attention: state.engine.attention,
    embeddingDim: state.embedding.dim,
  };
}

/**
 * Returns the minimum recall similarity threshold for the current runtime quality mode.
 *
 * Higher threshold (0.85) is used in degraded mode when the engine is not fully
 * loaded, reducing false-positive recall results at the cost of lower recall rate.
 *
 * @param state - Current runtime state.
 * @returns Minimum score threshold for recall filtering.
 */
export function getDefaultRecallThreshold(state: RuntimeState): number {
  return state.engine.loaded ? 0.6 : 0.85;
}

/**
 * Dependencies injected into handleRequest by the bootstrap.
 *
 * Using a context object instead of closures keeps the router testable:
 * tests can pass stub implementations without monkey-patching module globals.
 */
export interface RouterContext {
  /** Immutable orchestrator config loaded at startup. */
  config: OrchestratorConfig;
  /** Mutable runtime state shared across routes. */
  state: RuntimeState;
  /** Maximum request body bytes enforced by the body parser. */
  maxRequestBodyBytes: number;
  /** Bound embed function that uses the current runtime embedding state. */
  embedText: (content: string) => Promise<number[]>;
  /** Bound cached-embed function for recall scoring. */
  getCachedEmbedding: (content: string) => Promise<number[]>;
  /** Bound backfill function that writes to the current runtime pool. */
  backfill: (batchSize: number) => Promise<BackfillResult>;
}

/**
 * Routes an incoming HTTP request to the appropriate handler and writes the response.
 *
 * Auth: all routes except /health and /ready require the X-Internal-Key header.
 * Rate limits: memory-write, memory-recall, memory-vote, memory-forget, and
 * memory-backfill are subject to per-operation rate windows via allowRequest.
 *
 * @param req - Incoming HTTP request from the Node.js http server.
 * @param res - HTTP response to write.
 * @param ctx - Injected dependencies including config, state, and bound helpers.
 */
export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const { config, state } = ctx;
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  const parseBody = (r: http.IncomingMessage) =>
    parseJsonBody(r, ctx.maxRequestBodyBytes);

  const publicRoutes = new Set(["/health", "/ready"]);
  if (
    !publicRoutes.has(url) &&
    !hasValidInternalKey(req, config.internalApiKey)
  ) {
    sendJson(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "missing or invalid internal service key",
    });
    return;
  }

  // ── GET /health ────────────────────────────────────────────────────────────
  if (method === "GET" && url === "/health") {
    incrementMetric("my_brain_http_requests_total", {
      route: "/health",
      status: "200",
    });
    const capabilities = getCapabilities(state);
    sendJson(res, 200, {
      status: "ok",
      service: "my-brain-orchestrator",
      mode: config.mode,
      sonaEnabled: config.sonaEnabled,
      degraded: state.degradedReasons.length > 0,
      capabilities,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // ── GET /ready ─────────────────────────────────────────────────────────────
  if (method === "GET" && url === "/ready") {
    const capabilities = getCapabilities(state);
    const ready =
      capabilities.engine &&
      state.db.connected &&
      state.db.adrSchemasReady &&
      state.llm.loaded;

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
    sendJson(res, 200, { status: "ready", service: "my-brain-orchestrator" });
    return;
  }

  // ── GET /v1/status ─────────────────────────────────────────────────────────
  if (method === "GET" && url === "/v1/status") {
    incrementMetric("my_brain_http_requests_total", {
      route: "/v1/status",
      status: "200",
    });
    sendJson(res, 200, {
      service: "my-brain-orchestrator",
      mode: config.mode,
      runtime: {
        initializedAt: state.initializedAt,
        degradedReasons: state.degradedReasons,
      },
      llm: {
        model: config.llmModel,
        endpoint: config.llmUrl,
        loaded: state.llm.loaded,
        error: sanitizeStatusError(state.llm.error),
      },
      memory: {
        dbConfigured: config.dbUrl.length > 0,
        dbConnected: state.db.connected,
        extensionVersion: state.db.extensionVersion,
        adrSchemasReady: state.db.adrSchemasReady,
        error: sanitizeStatusError(state.db.error),
      },
    });
    return;
  }

  // ── GET /v1/capabilities ───────────────────────────────────────────────────
  if (method === "GET" && url === "/v1/capabilities") {
    const capabilities = getCapabilities(state);
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
      degradedReasons: state.degradedReasons,
      db: {
        extensionVersion: state.db.extensionVersion,
        adrSchemasReady: state.db.adrSchemasReady,
        embeddingProvider: state.embedding.provider,
        embeddingReady: state.embedding.ready,
      },
    });
    return;
  }

  // ── GET /v1/learning/stats ─────────────────────────────────────────────────
  if (method === "GET" && url === "/v1/learning/stats") {
    const sessionsClosed = Math.max(state.learning.sessionsClosed, 1);
    const avgQuality = state.learning.totalQuality / sessionsClosed;
    sendJson(res, 200, {
      success: true,
      learning: {
        sessions_opened: state.learning.sessionsOpened,
        sessions_closed: state.learning.sessionsClosed,
        successful_sessions: state.learning.successfulSessions,
        failed_sessions: state.learning.failedSessions,
        average_quality: Number(avgQuality.toFixed(3)),
        route: state.learning.currentRoute,
        route_confidence: Number(state.learning.routeConfidence.toFixed(3)),
      },
    });
    return;
  }

  // ── GET /metrics ───────────────────────────────────────────────────────────
  if (method === "GET" && url === "/metrics") {
    res.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
    res.end(renderMetrics());
    return;
  }

  // ── POST /v1/context/probe ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/context/probe") {
    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
    } catch {
      payload = {};
    }
    sendJson(res, 200, {
      success: true,
      context: buildProjectContext(payload as ProjectContextHints),
      degraded: state.degradedReasons.length > 0,
    });
    return;
  }

  // ── POST /v1/memory ────────────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory") {
    if (!allowRequest(asRateLimitReq(req), "memory-write")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory write rate limit exceeded",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
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
    const projCtx = buildProjectContext(payload as ProjectContextHints);
    envelope.metadata = {
      ...(envelope.metadata ?? {}),
      repo: envelope.metadata?.["repo"] ?? projCtx.repo,
      repo_name: envelope.metadata?.["repo_name"] ?? projCtx.repo_name,
      project: envelope.metadata?.["project"] ?? projCtx.project,
      language: envelope.metadata?.["language"] ?? projCtx.language,
      frameworks:
        Array.isArray(envelope.metadata?.["frameworks"]) &&
        (envelope.metadata["frameworks"] as unknown[]).length > 0
          ? envelope.metadata["frameworks"]
          : projCtx.frameworks,
      author: envelope.metadata?.["author"] ?? projCtx.author,
      source: envelope.metadata?.["source"] ?? projCtx.source,
    };

    if (!state.intelligenceEngine) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "memory engine unavailable",
      });
      return;
    }

    try {
      const embedding = await ctx.embedText(envelope.content);
      envelope.metadata = { ...(envelope.metadata ?? {}), embedding };

      const pool = state.pool;
      const duplicate = pool
        ? await findDuplicateMemory(
            pool,
            envelope,
            embedding,
            state.embedding.ready,
          )
        : null;

      if (duplicate && pool) {
        await pool.query(
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

      const remembered = await state.intelligenceEngine.remember(
        envelope.content,
        envelope.type,
      );
      const memoryId =
        sanitizeText(remembered?.["id"], 128) ??
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      if (pool) {
        await persistMemoryMetadata(pool, memoryId, envelope);
      }
      incrementMetric("mb_remember_total");

      sendJson(res, 200, {
        success: true,
        memory_id: memoryId,
        scope: envelope.scope,
        type: envelope.type,
      });
    } catch (error) {
      const msg =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
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

  // ── POST /v1/memory/recall ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/recall") {
    if (!allowRequest(asRateLimitReq(req), "memory-recall")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory recall rate limit exceeded",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const query = sanitizeText(payload["query"], 1024);
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
        parseInteger(String(payload["top_k"] ?? payload["topK"] ?? "8"), 8),
        1,
      ),
      20,
    );
    const minScoreRaw = payload["min_score"] ?? payload["minScore"];
    const minScore =
      typeof minScoreRaw === "number" && minScoreRaw >= 0 && minScoreRaw <= 1
        ? minScoreRaw
        : getDefaultRecallThreshold(state);

    if (!state.intelligenceEngine) {
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
        scope: sanitizeText(payload["scope"], 16),
        repo: sanitizeText(payload["repo"], 256),
        project: sanitizeText(payload["project"], 128),
        language: sanitizeText(payload["language"], 64),
        type: sanitizeText(payload["type"], 32),
        tags: sanitizeTags(payload["tags"]),
        frameworks: Array.isArray(payload["frameworks"])
          ? (payload["frameworks"] as unknown[])
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim().toLowerCase())
              .slice(0, 8)
          : [],
        include_expired:
          payload["include_expired"] === true ||
          payload["includeExpired"] === true,
        include_forgotten:
          payload["include_forgotten"] === true ||
          payload["includeForgotten"] === true,
        include_redacted:
          payload["include_redacted"] === true ||
          payload["includeRedacted"] === true,
      };

      const candidateLimit = Math.min(Math.max(topK * 6, 30), 150);
      const queryEmbedding = await ctx.getCachedEmbedding(query);

      const pool = state.pool;
      const candidates = pool
        ? await queryRecallCandidates(
            pool,
            filters,
            candidateLimit,
            queryEmbedding,
          )
        : [];

      const memoryIds = candidates.map((c) => String(c.memory_id));
      const voteByMemoryId =
        pool && memoryIds.length > 0
          ? await loadVoteBias(pool, memoryIds)
          : new Map<string, { up: number; down: number; bias: number }>();

      const scored = candidates.map(async (candidate) => {
        const content =
          typeof candidate.content === "string" ? candidate.content : "";
        const storedEmbedding = asVector(candidate.embedding);
        const contentEmbedding =
          storedEmbedding ?? (await ctx.getCachedEmbedding(content));
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
        .filter((e) => typeof e.score === "number" && e.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((e) => ({ ...e, score: Number(e.score.toFixed(3)) }));

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
      logInternalError("recall failure", error, config.logLevel);
      sendJson(res, 500, {
        success: false,
        error: "SERVER_ERROR",
        message: "failed to recall memory",
      });
    }
    return;
  }

  // ── POST /v1/memory/vote ───────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/vote") {
    if (!allowRequest(asRateLimitReq(req), "memory-vote")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory vote rate limit exceeded",
      });
      return;
    }

    const pool = state.pool;
    if (!pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "vote storage unavailable",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const memoryId = sanitizeText(payload["memory_id"] ?? payload["id"], 128);
    const direction = sanitizeText(payload["direction"], 8)?.toLowerCase();
    const reason = sanitizeText(payload["reason"], 500);

    if (!memoryId || (direction !== "up" && direction !== "down")) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "memory_id and direction(up|down) are required",
      });
      return;
    }

    await pool.query(
      `INSERT INTO my_brain_memory_votes (memory_id, direction, reason, source)
       VALUES ($1, $2, $3, $4)`,
      [memoryId, direction, reason, "mb_vote"],
    );

    const voteStats = await pool.query<{ up: number; down: number }>(
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
    await pool.query(
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

  // ── POST /v1/memory/forget ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/forget") {
    if (!allowRequest(asRateLimitReq(req), "memory-forget")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory forget rate limit exceeded",
      });
      return;
    }

    const pool = state.pool;
    if (!pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "metadata storage unavailable",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const memoryId = sanitizeText(payload["memory_id"] ?? payload["id"], 128);
    const mode =
      sanitizeText(payload["mode"], 8)?.toLowerCase() === "hard"
        ? "hard"
        : "soft";

    if (!memoryId) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "memory_id is required",
      });
      return;
    }

    if (mode === "hard") {
      await pool.query(
        "DELETE FROM my_brain_memory_metadata WHERE memory_id = $1",
        [memoryId],
      );
    } else {
      await pool.query(
        "UPDATE my_brain_memory_metadata SET forgotten_at = NOW() WHERE memory_id = $1",
        [memoryId],
      );
    }
    incrementMetric("mb_forget_total", { mode });

    sendJson(res, 200, { success: true, memory_id: memoryId, mode });
    return;
  }

  // ── POST /v1/session/open ──────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/session/open") {
    const pool = state.pool;
    if (!pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "session storage unavailable",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const sessionId = sanitizeText(payload["session_id"], 128) ?? randomUUID();
    const agent = sanitizeText(payload["agent"], 128) ?? "main";
    const context =
      typeof payload["context"] === "object" &&
      payload["context"] !== null &&
      !Array.isArray(payload["context"])
        ? (payload["context"] as Record<string, unknown>)
        : buildProjectContext();

    await pool.query(
      `INSERT INTO my_brain_sessions (session_id, agent, context)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, agent, JSON.stringify(context)],
    );

    if (state.intelligenceEngine) {
      state.intelligenceEngine.beginTrajectory("session_open", "session");
      state.intelligenceEngine.setTrajectoryRoute(agent);
    }
    state.learning.sessionsOpened += 1;
    state.learning.currentRoute = agent;

    sendJson(res, 200, {
      success: true,
      session_id: sessionId,
      agent,
      route_confidence: state.learning.routeConfidence,
    });
    return;
  }

  // ── POST /v1/session/close ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/session/close") {
    const pool = state.pool;
    if (!pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "session storage unavailable",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const sessionId = sanitizeText(payload["session_id"], 128);
    if (!sessionId) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: "session_id is required",
      });
      return;
    }

    const success = payload["success"] !== false;
    const quality =
      typeof payload["quality"] === "number" ? payload["quality"] : null;
    const reason = sanitizeText(payload["reason"], 500);

    await pool.query(
      `UPDATE my_brain_sessions
       SET closed_at = NOW(), success = $2, quality = $3, reason = $4
       WHERE session_id = $1`,
      [sessionId, success, quality, reason],
    );

    if (state.intelligenceEngine) {
      state.intelligenceEngine.endTrajectory(success, quality ?? undefined);
    }
    state.learning.sessionsClosed += 1;
    if (success) {
      state.learning.successfulSessions += 1;
      state.learning.routeConfidence = Math.min(
        0.99,
        state.learning.routeConfidence + 0.05,
      );
    } else {
      state.learning.failedSessions += 1;
      state.learning.routeConfidence = Math.max(
        0.05,
        state.learning.routeConfidence - 0.05,
      );
    }
    if (typeof quality === "number") {
      state.learning.totalQuality += quality;
    }

    sendJson(res, 200, {
      success: true,
      session_id: sessionId,
      closed: true,
      route_confidence: Number(state.learning.routeConfidence.toFixed(3)),
    });
    return;
  }

  // ── POST /v1/memory/digest ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/digest") {
    if (!allowRequest(asRateLimitReq(req), "memory-digest")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory digest rate limit exceeded",
      });
      return;
    }

    const pool = state.pool;
    if (!pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "digest storage unavailable",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message:
          error instanceof Error ? error.message : "invalid json payload",
      });
      return;
    }

    const since = normalizeDigestSince(payload["since"]);
    const summary = await pool.query(
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
        sessions_opened: state.learning.sessionsOpened,
        sessions_closed: state.learning.sessionsClosed,
        successful_sessions: state.learning.successfulSessions,
        failed_sessions: state.learning.failedSessions,
        route: state.learning.currentRoute,
        route_confidence: Number(state.learning.routeConfidence.toFixed(3)),
      },
    });
    return;
  }

  // ── POST /v1/memory/backfill ───────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/backfill") {
    if (!allowRequest(asRateLimitReq(req), "memory-backfill")) {
      sendJson(res, 429, {
        success: false,
        error: "RATE_LIMITED",
        message: "memory backfill rate limit exceeded",
      });
      return;
    }

    if (!state.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "metadata storage unavailable",
      });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(req);
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
      Math.max(parseInteger(String(payload["batch_size"] ?? "200"), 200), 1),
      1000,
    );
    const result = await ctx.backfill(batchSize);

    sendJson(res, 200, { success: true, batch_size: batchSize, ...result });
    return;
  }

  // ── 404 fallthrough ────────────────────────────────────────────────────────
  sendJson(res, 404, {
    error: "not_found",
    message: "Route not implemented in bootstrap orchestrator",
  });
}
