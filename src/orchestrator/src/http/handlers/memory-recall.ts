/**
 * POST /v1/memory/recall — vector + lexical memory retrieval.
 *
 * Accepts a natural language query, embeds it, fetches metadata candidates
 * from Postgres, scores each candidate using semantic similarity + lexical
 * boost + vote bias, and returns the top-K results above the min_score gate.
 *
 * Filter normalization is delegated to `memory-recall.filters.ts`.
 * Scoring and ranking are delegated to `memory-recall.scoring.ts`.
 * Rate-limited via the "memory-recall" bucket.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseJsonBody } from "../body.js";
import { allowRequest } from "../../policies/rate-limit.js";
import {
  incrementMetric,
  observeDurationMs,
} from "../../observability/metrics.js";
import { logInternalError } from "../../observability/log.js";
import { parseInteger } from "../../config/load-config.js";
import { sanitizeText } from "../../domain/memory-validation.js";
import { queryRecallCandidates } from "../../infrastructure/postgres-memory.js";
import { getDefaultRecallThreshold } from "../router-context.js";
import { normalizeRecallFilters } from "./memory-recall.filters.js";
import { scoreAndRankCandidates } from "./memory-recall.scoring.js";
import { wrapWithSynthesis } from "./_envelope.js";

/** Adapter type matching the rate-limit module's socket expectation. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Handles POST /v1/memory/recall: embeds query, scores candidates, returns ranked results.
 *
 * @param req - Incoming request.
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleMemoryRecall(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const { config, state } = ctx;

  if (!allowRequest(req as unknown as AllowRequestReq, "memory-recall")) {
    sendJson(res, 429, {
      success: false,
      error: "RATE_LIMITED",
      message: "memory recall rate limit exceeded",
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

  const originalQuery = sanitizeText(payload["query"], 1024);
  if (!originalQuery) {
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
    const filters = normalizeRecallFilters(payload);
    const candidateLimit = Math.min(Math.max(topK * 6, 30), 150);

    const queryEmbedding = await ctx.getCachedEmbedding(originalQuery);

    const pool = state.pool;
    const candidates = pool
      ? await queryRecallCandidates(
          pool,
          filters,
          candidateLimit,
          queryEmbedding,
        )
      : [];

    const filtered = await scoreAndRankCandidates(
      candidates,
      originalQuery,
      queryEmbedding,
      topK,
      minScore,
      { pool, getCachedEmbedding: ctx.getCachedEmbedding },
    );

    incrementMetric("mb_recall_total", {
      result: filtered.length > 0 ? "hit" : "miss",
    });
    observeDurationMs("mb_recall_latency_ms", Date.now() - recallStart);

    const envelope = await wrapWithSynthesis(ctx, "mb_recall", originalQuery, {
      query: originalQuery,
      top_k: topK,
      min_score: minScore,
      results: filtered,
    });

    sendJson(res, 200, envelope);
  } catch (error) {
    logInternalError("recall failure", error, config.logLevel);
    sendJson(res, 500, {
      success: false,
      error: "SERVER_ERROR",
      message: "failed to recall memory",
    });
  }
}
