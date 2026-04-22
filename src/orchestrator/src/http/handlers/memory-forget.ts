/**
 * POST /v1/memory/forget — soft or hard delete a stored memory.
 *
 * Soft delete sets `forgotten_at = NOW()` so the row is excluded from default
 * recall but remains recoverable via `include_forgotten=true`. Hard delete
 * removes the row from the metadata table permanently.
 *
 * Rate-limited via the "memory-forget" bucket.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseJsonBody } from "../body.js";
import { allowRequest } from "../../policies/rate-limit.js";
import { incrementMetric } from "../../observability/metrics.js";
import { sanitizeText } from "../../domain/memory-validation.js";

/** Adapter type matching the rate-limit module's socket expectation. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Handles POST /v1/memory/forget: soft or permanently removes a memory.
 *
 * @param req - Incoming request.
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleMemoryForget(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const { state } = ctx;

  if (!allowRequest(req as unknown as AllowRequestReq, "memory-forget")) {
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
    // Soft delete — row remains in DB for audit and recovery via include_forgotten.
    await pool.query(
      "UPDATE my_brain_memory_metadata SET forgotten_at = NOW() WHERE memory_id = $1",
      [memoryId],
    );
  }
  incrementMetric("mb_forget_total", { mode });

  sendJson(res, 200, { success: true, memory_id: memoryId, mode });
}
