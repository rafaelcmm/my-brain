/**
 * GET /v1/memory/{id} — fetch single metadata record by exact id.
 *
 * Removes list-and-filter anti-pattern from web adapter and gives stable
 * O(1) lookup semantics for detail pages.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { sanitizeText } from "../../domain/memory-validation.js";

/**
 * Handles GET /v1/memory/{id}.
 *
 * @param req - Incoming request used to parse path id segment.
 * @param res - HTTP response writer.
 * @param ctx - Router dependencies with Postgres pool.
 */
export async function handleMemoryGet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const pool = ctx.state.pool;
  if (!pool) {
    sendJson(res, 503, {
      success: false,
      error: "SERVER_ERROR",
      message: "metadata storage unavailable",
    });
    return;
  }

  const requestUrl = new URL(
    req.url ?? "/v1/memory/unknown",
    "http://localhost",
  );
  const id = sanitizeText(
    decodeURIComponent(requestUrl.pathname.replace("/v1/memory/", "")),
    256,
  );

  if (!id) {
    sendJson(res, 400, {
      success: false,
      error: "INVALID_INPUT",
      message: "memory id is required",
    });
    return;
  }

  const result = await pool.query<{
    memory_id: string;
    content: string;
    type: string;
    scope: string;
    repo_name: string | null;
    language: string | null;
    tags: unknown;
    created_at: string;
    last_seen_at: string;
    use_count: number;
    metadata: unknown;
  }>(
    `SELECT
      memory_id,
      content,
      type,
      scope,
      repo_name,
      language,
      tags,
      created_at,
      last_seen_at,
      use_count,
      metadata
     FROM my_brain_memory_metadata
     WHERE memory_id = $1
       AND forgotten_at IS NULL
       AND redacted_at IS NULL
     LIMIT 1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) {
    sendJson(res, 404, {
      success: false,
      error: "NOT_FOUND",
      message: "memory not found",
    });
    return;
  }

  sendJson(res, 200, {
    id: row.memory_id,
    content: row.content,
    type: row.type,
    scope: row.scope,
    repo_name: row.repo_name,
    language: row.language,
    tags: Array.isArray(row.tags) ? row.tags : [],
    metadata:
      row.metadata &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata)
        ? row.metadata
        : {},
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    use_count: row.use_count,
  });
}
