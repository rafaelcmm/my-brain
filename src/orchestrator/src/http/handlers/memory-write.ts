/**
 * POST /v1/memory — memory capture with deduplication and embedding.
 *
 * Accepts a validated memory envelope, enriches it with project context,
 * runs deduplication against existing memories (fingerprint + semantic),
 * calls the intelligence engine to persist the memory, and writes the
 * sidecar metadata row to Postgres.
 *
 * Rate-limited via the "memory-write" bucket.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseJsonBody } from "../body.js";
import { allowRequest } from "../../policies/rate-limit.js";
import { incrementMetric } from "../../observability/metrics.js";
import {
  sanitizeText,
  validateMemoryEnvelope,
} from "../../domain/memory-validation.js";
import {
  findDuplicateMemory,
  persistMemoryMetadata,
} from "../../infrastructure/postgres-memory.js";
import { buildProjectContext } from "../../application/project-context.js";
import type { ProjectContextHints } from "../../application/project-context.js";
import { wrapWithSynthesis } from "./_envelope.js";

/** Adapter type matching the rate-limit module's socket expectation. */
type AllowRequestReq = Parameters<typeof allowRequest>[0];

/**
 * Handles POST /v1/memory: validates, deduplicates, embeds, and stores memory.
 *
 * @param req - Incoming request.
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleMemoryWrite(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const { state } = ctx;

  if (!allowRequest(req as unknown as AllowRequestReq, "memory-write")) {
    sendJson(res, 429, {
      success: false,
      error: "RATE_LIMITED",
      message: "memory write rate limit exceeded",
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
      // Bump use count on the existing row rather than creating a duplicate.
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
      const envelopePayload = await wrapWithSynthesis(ctx, "mb_remember", null, {
        memory_id: duplicate.memoryId,
        scope: envelope.scope,
        type: envelope.type,
        deduped: true,
        dedup_reason: duplicate.reason,
        matched_id: duplicate.memoryId,
        score: Number(duplicate.score.toFixed(3)),
      });
      sendJson(res, 200, envelopePayload);
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

    const envelopePayload = await wrapWithSynthesis(ctx, "mb_remember", null, {
      memory_id: memoryId,
      scope: envelope.scope,
      type: envelope.type,
      deduped: false,
    });
    sendJson(res, 200, envelopePayload);
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
}
