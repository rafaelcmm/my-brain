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
import {
  processRecallQuery,
  synthesizeRecallAnswer,
} from "../../infrastructure/query-processing.js";

/** Adapter type matching the rate-limit module's socket expectation. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

const PROCESSED_QUERY_MODEL = "qwen3.5:0.8b";

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

  const rawMode = payload["mode"];
  const modeRaw =
    rawMode === undefined
      ? "raw"
      : (sanitizeText(rawMode, 16) ?? "").toLowerCase();
  const mode = modeRaw;

  if (mode !== "raw" && mode !== "processed") {
    sendJson(res, 400, {
      success: false,
      error: "INVALID_INPUT",
      message: "mode must be raw or processed",
    });
    return;
  }

  const requestedModel = sanitizeText(payload["model"], 64);
  if (mode === "raw" && requestedModel) {
    sendJson(res, 400, {
      success: false,
      error: "INVALID_INPUT",
      message: "model is only allowed when mode is processed",
    });
    return;
  }

  // Validate model for processed mode before hitting orchestration infrastructure.
  if (mode === "processed") {
    const effectiveModel = requestedModel || config.llmModel;
    if (effectiveModel !== PROCESSED_QUERY_MODEL) {
      sendJson(res, 400, {
        success: false,
        error: "INVALID_INPUT",
        message: `processed mode only supports model ${PROCESSED_QUERY_MODEL}`,
      });
      return;
    }
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

    let queryForRecall = originalQuery;
    let processedQueryMeta:
      | {
          original_query: string;
          processed_query: string;
          model: string;
          processing_latency_ms: number;
          processing_fallback?: boolean;
          processing_error?: string;
        }
      | undefined;
    let synthesizedAnswerMeta:
      | {
          synthesized_answer: string;
          synthesis_model: string;
          synthesis_latency_ms: number;
          synthesis_error?: string;
        }
      | undefined;

    if (mode === "processed") {
      const model = requestedModel || config.llmModel;
      // Model already validated above; this assertion is a safety guard only.
      if (model !== PROCESSED_QUERY_MODEL) {
        sendJson(res, 400, {
          success: false,
          error: "INVALID_INPUT",
          message: `processed mode only supports model ${PROCESSED_QUERY_MODEL}`,
        });
        return;
      }

      const processStartedAt = Date.now();
      try {
        const processed = await processRecallQuery({
          llmUrl: config.llmUrl,
          model,
          query: originalQuery,
          timeoutMs: config.recallProcessTimeoutMs,
        });
        queryForRecall = processed.processedQuery;
        processedQueryMeta = {
          original_query: processed.originalQuery,
          processed_query: processed.processedQuery,
          model: processed.model,
          processing_latency_ms: processed.latencyMs,
        };
      } catch (processingError) {
        // Keep recall available for operators even when rewrite model is cold or flaky.
        queryForRecall = originalQuery;
        processedQueryMeta = {
          original_query: originalQuery,
          processed_query: originalQuery,
          model,
          processing_latency_ms: Date.now() - processStartedAt,
          processing_fallback: true,
          processing_error:
            processingError instanceof Error
              ? processingError.message
              : "query rewrite failed",
        };
      }
    }

    const queryEmbedding = await ctx.getCachedEmbedding(queryForRecall);

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
      queryForRecall,
      queryEmbedding,
      topK,
      minScore,
      { pool, getCachedEmbedding: ctx.getCachedEmbedding },
    );

    if (mode === "processed" && filtered.length > 0) {
      const synthesisModel = requestedModel || config.llmModel;
      try {
        const synthesized = await synthesizeRecallAnswer({
          llmUrl: config.llmUrl,
          model: synthesisModel,
          question: originalQuery,
          results: filtered.map((item) => ({
            id: String(item.id),
            content: String(item.content),
            score: item.score,
          })),
          timeoutMs: config.recallProcessTimeoutMs,
        });

        synthesizedAnswerMeta = {
          synthesized_answer: synthesized.answer,
          synthesis_model: synthesized.model,
          synthesis_latency_ms: synthesized.latencyMs,
        };
      } catch (synthesisError) {
        synthesizedAnswerMeta = {
          synthesized_answer: "",
          synthesis_model: synthesisModel,
          synthesis_latency_ms: 0,
          synthesis_error:
            synthesisError instanceof Error
              ? synthesisError.message
              : "answer synthesis failed",
        };
      }
    }

    incrementMetric("mb_recall_total", {
      result: filtered.length > 0 ? "hit" : "miss",
    });
    observeDurationMs("mb_recall_latency_ms", Date.now() - recallStart);

    sendJson(res, 200, {
      success: true,
      query: queryForRecall,
      mode,
      top_k: topK,
      min_score: minScore,
      ...(processedQueryMeta ?? { original_query: originalQuery }),
      ...(synthesizedAnswerMeta ?? {}),
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
}
