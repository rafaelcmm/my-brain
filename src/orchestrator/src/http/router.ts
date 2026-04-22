/**
 * HTTP request router for all orchestrator API endpoints.
 *
 * Authenticates every request, then dispatches to per-route handler functions
 * located in ./handlers/. Inline routes are limited to simple read-only
 * endpoints that require no separate abstraction (≤30 lines each).
 *
 * Route catalogue:
 *   GET  /health                      — liveness + capabilities
 *   GET  /ready                       — dependency readiness gate
 *   GET  /v1/status                   — full runtime status
 *   GET  /v1/capabilities             — feature flags + embedding info
 *   GET  /v1/learning/stats           — SONA learning counters
 *   GET  /metrics                     — Prometheus text exposition
 *   POST /v1/context/probe            — project context detection
 *   POST /v1/memory                   → handlers/memory-write.ts
 *   POST /v1/memory/recall            → handlers/memory-recall.ts
 *   POST /v1/memory/vote              → handlers/memory-vote.ts
 *   POST /v1/memory/forget            → handlers/memory-forget.ts
 *   POST /v1/session/open             → handlers/session.ts
 *   POST /v1/session/close            → handlers/session.ts
 *   POST /v1/memory/digest            → handlers/memory-digest.ts
 *   POST /v1/memory/backfill          — heal legacy rows (inline, simple)
 */

import type http from "node:http";
import { sendJson } from "./response.js";
import { parseJsonBody } from "./body.js";
import { allowRequest } from "../policies/rate-limit.js";
import { hasValidInternalKey } from "../policies/auth.js";
import { incrementMetric, renderMetrics } from "../observability/metrics.js";
import { sanitizeStatusError } from "../observability/log.js";
import { type loadConfig, parseInteger } from "../config/load-config.js";
import type { ProjectContextHints } from "../application/project-context.js";
import { buildProjectContext } from "../application/project-context.js";
import { normalizeDigestSince } from "../application/backfill.js";
import {
  getCapabilities,
  getDefaultRecallThreshold,
} from "./router-context.js";
import type { Capabilities, RouterContext } from "./router-context.js";
import { handleMemoryWrite } from "./handlers/memory-write.js";
import { handleMemoryRecall } from "./handlers/memory-recall.js";
import { handleMemoryVote } from "./handlers/memory-vote.js";
import { handleMemoryForget } from "./handlers/memory-forget.js";
import { handleSessionOpen, handleSessionClose } from "./handlers/session.js";
import { handleMemoryDigest } from "./handlers/memory-digest.js";

// Re-export shared types so callers that already import from router.ts continue to work.
export type { Capabilities, RouterContext };
export { getCapabilities, getDefaultRecallThreshold };

/** Inferred config shape from loadConfig return value. */
type _OrchestratorConfig = ReturnType<typeof loadConfig>;

/** Shape expected by allowRequest's socket parameter. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Routes an incoming HTTP request to the appropriate handler and writes the response.
 *
 * Auth: all routes except /health and /ready require the X-Mybrain-Internal-Key header.
 * Rate limits: memory-write, memory-recall, memory-vote, memory-forget, session, and
 * memory-backfill are subject to per-operation rate windows enforced by their handlers.
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

  // Auth gate — /health and /ready are public so upstreams can probe without a key.
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
    sendJson(res, 200, {
      status: "ok",
      service: "my-brain-orchestrator",
      mode: config.mode,
      sonaEnabled: config.sonaEnabled,
      degraded: state.degradedReasons.length > 0,
      capabilities: getCapabilities(state),
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
      context: buildProjectContext(payload as unknown as ProjectContextHints),
      degraded: state.degradedReasons.length > 0,
    });
    return;
  }

  // ── POST /v1/memory ────────────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory") {
    return handleMemoryWrite(req, res, ctx);
  }

  // ── POST /v1/memory/recall ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/recall") {
    return handleMemoryRecall(req, res, ctx);
  }

  // ── POST /v1/memory/vote ───────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/vote") {
    return handleMemoryVote(req, res, ctx);
  }

  // ── POST /v1/memory/forget ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/forget") {
    return handleMemoryForget(req, res, ctx);
  }

  // ── POST /v1/session/open ──────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/session/open") {
    return handleSessionOpen(req, res, ctx);
  }

  // ── POST /v1/session/close ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/session/close") {
    return handleSessionClose(req, res, ctx);
  }

  // ── POST /v1/memory/digest ─────────────────────────────────────────────────
  if (method === "POST" && url === "/v1/memory/digest") {
    return handleMemoryDigest(req, res, ctx);
  }

  // ── POST /v1/memory/backfill ───────────────────────────────────────────────
  // Kept inline: this route has no domain logic — it forwards directly to the
  // bound ctx.backfill function which operates on the current pool.
  if (method === "POST" && url === "/v1/memory/backfill") {
    if (!allowRequest(req as unknown as AllowRequestReq, "memory-backfill")) {
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

  // normalizeDigestSince is used only via the delegated memory-digest handler,
  // but imported here to verify the export exists at compile time.
  void normalizeDigestSince;
}
