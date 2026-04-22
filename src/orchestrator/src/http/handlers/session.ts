/**
 * POST /v1/session/open and POST /v1/session/close — SONA learning trajectory.
 *
 * Session open begins a SONA learning trajectory and inserts a row into the
 * sessions table. Session close marks it as completed, records success/quality,
 * and updates the rolling route confidence.
 *
 * Sessions are used by SONA to correlate memory operations with outcome
 * quality so the system can adaptively prefer routes and scope patterns
 * that produce positive outcomes.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseJsonBody } from "../body.js";
import { allowRequest } from "../../policies/rate-limit.js";
import { sanitizeText } from "../../domain/memory-validation.js";
import { buildProjectContext } from "../../application/project-context.js";
import { randomUUID } from "node:crypto";

/** Adapter type matching the rate-limit module's socket expectation. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Handles POST /v1/session/open: creates a session and begins a SONA trajectory.
 *
 * @param req - Incoming request.
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleSessionOpen(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  // Rate-limit session creation to prevent rapid session churn attacks.
  if (!allowRequest(req as unknown as AllowRequestReq, "session-open")) {
    sendJson(res, 429, {
      success: false,
      error: "RATE_LIMITED",
      message: "session open rate limit exceeded",
    });
    return;
  }

  const { state } = ctx;

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
    payload = await parseJsonBody(req, ctx.maxRequestBodyBytes);
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: "INVALID_INPUT",
      message: error instanceof Error ? error.message : "invalid json payload",
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
}

/**
 * Handles POST /v1/session/close: marks session completed and adjusts route confidence.
 *
 * Route confidence is nudged up on success (capped at 0.99) and down on failure
 * (floored at 0.05) so the system degrades gracefully without oscillating wildly.
 *
 * @param req - Incoming request.
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleSessionClose(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  // Rate-limit session closure to prevent rapid session churn attacks.
  if (!allowRequest(req as unknown as AllowRequestReq, "session-close")) {
    sendJson(res, 429, {
      success: false,
      error: "RATE_LIMITED",
      message: "session close rate limit exceeded",
    });
    return;
  }

  const { state } = ctx;

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
    payload = await parseJsonBody(req, ctx.maxRequestBodyBytes);
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: "INVALID_INPUT",
      message: error instanceof Error ? error.message : "invalid json payload",
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
}
