/**
 * POST /v1/memory/recall — vector + lexical memory retrieval.
 *
 * Accepts a natural language query, embeds it, fetches metadata candidates
 * from Postgres, scores each candidate using semantic similarity + lexical
 * boost + vote bias, and returns the top-K results above the min_score gate.
 *
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
import { sanitizeTags, sanitizeText } from "../../domain/memory-validation.js";
import { asVector } from "../../domain/fingerprint.js";
import { lexicalBoost, similarity } from "../../domain/scoring.js";
import {
  loadVoteBias,
  queryRecallCandidates,
} from "../../infrastructure/postgres-memory.js";
import { getDefaultRecallThreshold } from "../router-context.js";

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
}
