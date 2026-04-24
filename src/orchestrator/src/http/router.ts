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
 *   GET  /v1/memory/summary           → handlers/memory-summary.ts
 *   GET  /v1/memory/list              → handlers/memory-list.ts
 *   GET  /v1/memory/graph             → handlers/memory-graph.ts
 *   GET  /v1/memory/{id}              → handlers/memory-get.ts
 */

import type http from "node:http";
import { sendJson } from "./response.js";
import { parseJsonBody } from "./body.js";
import { hasValidInternalKey } from "../policies/auth.js";
import { incrementMetric, renderMetrics } from "../observability/metrics.js";
import { sanitizeStatusError } from "../observability/log.js";
import { type loadConfig } from "../config/load-config.js";
import type { ProjectContextHints } from "../application/project-context.js";
import { buildProjectContext } from "../application/project-context.js";
import {
  getCapabilities,
  getDefaultRecallThreshold,
} from "./router-context.js";
import { getPersistedLearningStats } from "../application/learning-stats.js";
import type { Capabilities, RouterContext } from "./router-context.js";
import { handleMemoryWrite } from "./handlers/memory-write.js";
import { handleMemoryRecall } from "./handlers/memory-recall.js";
import { handleMemoryVote } from "./handlers/memory-vote.js";
import { handleMemoryForget } from "./handlers/memory-forget.js";
import { handleSessionOpen, handleSessionClose } from "./handlers/session.js";
import { handleMemoryDigest } from "./handlers/memory-digest.js";
import { handleMemorySummary } from "./handlers/memory-summary.js";
import { handleMemoryList } from "./handlers/memory-list.js";
import { handleMemoryGraph } from "./handlers/memory-graph.js";
import { handleMemoryGet } from "./handlers/memory-get.js";
import { wrapWithSynthesis } from "./handlers/_envelope.js";

// Re-export shared types so callers that already import from router.ts continue to work.
export type { Capabilities, RouterContext };
export { getCapabilities, getDefaultRecallThreshold };

/** Inferred config shape from loadConfig return value. */
type _OrchestratorConfig = ReturnType<typeof loadConfig>;

/**
 * Routes an incoming HTTP request to the appropriate handler and writes the response.
 *
 * Auth: all routes except /health and /ready require the X-Mybrain-Internal-Key header.
 * Rate limits: memory-write, memory-recall, memory-vote, memory-forget, session, and
 * memory-digest are subject to per-operation rate windows enforced by their handlers.
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
    const envelope = await wrapWithSynthesis(ctx, "mb_capabilities", null, {
      capabilities,
      features: {
        vectorDb: capabilities.vectorDb,
        sona: capabilities.sona,
        attention: capabilities.attention,
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
    sendJson(res, 200, envelope);
    return;
  }

  // ── GET /v1/learning/stats ─────────────────────────────────────────────────
  if (method === "GET" && url === "/v1/learning/stats") {
    if (!state.pool) {
      sendJson(res, 503, {
        success: false,
        error: "SERVER_ERROR",
        message: "learning stats storage unavailable",
      });
      return;
    }

    const learningStats = await getPersistedLearningStats(state.pool);
    sendJson(res, 200, {
      success: true,
      learning: {
        sessions_opened: learningStats.sessions_opened,
        sessions_closed: learningStats.sessions_closed,
        successful_sessions: learningStats.successful_sessions,
        failed_sessions: learningStats.failed_sessions,
        average_quality: learningStats.average_quality,
        route: learningStats.route,
        route_confidence: learningStats.route_confidence,
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
    const envelope = await wrapWithSynthesis(
      ctx,
      "mb_context_probe",
      typeof payload["cwd"] === "string" ? payload["cwd"] : null,
      {
      context: buildProjectContext(payload as unknown as ProjectContextHints),
      degraded: state.degradedReasons.length > 0,
      },
    );
    sendJson(res, 200, envelope);
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

  // ── GET /v1/memory/summary ─────────────────────────────────────────────────
  if (method === "GET" && url === "/v1/memory/summary") {
    return handleMemorySummary(req, res, ctx);
  }

  // ── GET /v1/memory/list ────────────────────────────────────────────────────
  if (method === "GET" && url.startsWith("/v1/memory/list")) {
    return handleMemoryList(req, res, ctx);
  }

  // ── GET /v1/memory/graph ───────────────────────────────────────────────────
  if (method === "GET" && url.startsWith("/v1/memory/graph")) {
    return handleMemoryGraph(req, res, ctx);
  }

  // ── GET /v1/memory/{id} ────────────────────────────────────────────────────
  if (
    method === "GET" &&
    url.startsWith("/v1/memory/") &&
    !url.startsWith("/v1/memory/list") &&
    !url.startsWith("/v1/memory/graph") &&
    !url.startsWith("/v1/memory/summary")
  ) {
    return handleMemoryGet(req, res, ctx);
  }

  // ── 404 fallthrough ────────────────────────────────────────────────────────
  sendJson(res, 404, {
    error: "not_found",
    message: "Route not implemented in bootstrap orchestrator",
  });
}
