/**
 * POST /v1/memory/digest — aggregate memory statistics by type/language/repo.
 *
 * Returns counts grouped by (type, language, repo_name) for memories created
 * after the supplied `since` window. Active, expired, forgotten, and redacted
 * counts are broken out so operators can assess memory health at a glance.
 * Learning telemetry is appended so callers can correlate quality trends with
 * session outcomes.
 *
 * Rate-limited via the "memory-digest" bucket.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseJsonBody } from "../body.js";
import { allowRequest } from "../../policies/rate-limit.js";
import { normalizeDigestSince } from "../../application/backfill.js";

/** Adapter type matching the rate-limit module's socket expectation. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Handles POST /v1/memory/digest: returns aggregate stats for memory health.
 *
 * @param req - Incoming request.
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleMemoryDigest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const { state } = ctx;

  if (!allowRequest(req as unknown as AllowRequestReq, "memory-digest")) {
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
    payload = await parseJsonBody(req, ctx.maxRequestBodyBytes);
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: "INVALID_INPUT",
      message: error instanceof Error ? error.message : "invalid json payload",
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
}
