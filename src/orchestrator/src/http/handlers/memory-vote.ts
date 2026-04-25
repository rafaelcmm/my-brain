/**
 * POST /v1/memory/vote — upvote or downvote a stored memory.
 *
 * Inserts a vote row and synchronously updates the pre-computed vote_bias
 * column on the memory row so recall scoring reads the current value without
 * performing a live aggregate on every request.
 *
 * Rate-limited via the "memory-vote" bucket.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseJsonBody } from "../body.js";
import { allowRequest } from "../../policies/rate-limit.js";
import { incrementMetric } from "../../observability/metrics.js";
import { sanitizeText } from "../../domain/memory-validation.js";
import { voteBias } from "../../domain/scoring.js";
import { wrapWithSynthesis } from "./_envelope.js";

/** Adapter type matching the rate-limit module's socket expectation. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Handles POST /v1/memory/vote: records a vote and recomputes the bias column.
 *
 * @param req - Incoming request.
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleMemoryVote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const { state } = ctx;

  if (!allowRequest(req as unknown as AllowRequestReq, "memory-vote")) {
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
    payload = await parseJsonBody(req, ctx.maxRequestBodyBytes);
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: "INVALID_INPUT",
      message: error instanceof Error ? error.message : "invalid json payload",
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

  // Write pre-computed bias back to the memory row so recall scoring
  // reads the current value without aggregating votes on the hot path.
  await pool.query(
    "UPDATE my_brain_memory_metadata SET vote_bias = $2 WHERE memory_id = $1",
    [memoryId, bias],
  );
  incrementMetric("mb_vote_total", { direction });

  const envelope = await wrapWithSynthesis(ctx, "mb_vote", null, {
    memory_id: memoryId,
    direction,
    vote_bias: bias,
    votes_up: up,
    votes_down: down,
  });
  sendJson(res, 200, envelope);
}
