/**
 * GET /v1/memory/summary — high-level memory and learning aggregates.
 *
 * Exposes compact dashboard metrics so web clients avoid shipping multiple
 * heavy aggregate queries over slow links.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";

/**
 * Handles GET /v1/memory/summary.
 *
 * @param _req - Incoming request (unused).
 * @param res - Server response.
 * @param ctx - Injected router dependencies.
 */
export async function handleMemorySummary(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  const { state } = ctx;
  const pool = state.pool;

  if (!pool) {
    sendJson(res, 503, {
      success: false,
      error: "SERVER_ERROR",
      message: "metadata storage unavailable",
    });
    return;
  }

  const [total, byScope, byType, tags, frameworks, languages] = await Promise.all([
    pool.query<{ total_memories: number }>(
      `SELECT COUNT(*)::int AS total_memories
       FROM my_brain_memory_metadata
       WHERE forgotten_at IS NULL AND redacted_at IS NULL`,
    ),
    pool.query<{ scope: string; count: number }>(
      `SELECT scope, COUNT(*)::int AS count
       FROM my_brain_memory_metadata
       WHERE forgotten_at IS NULL AND redacted_at IS NULL
       GROUP BY scope`,
    ),
    pool.query<{ type: string; count: number }>(
      `SELECT type, COUNT(*)::int AS count
       FROM my_brain_memory_metadata
       WHERE forgotten_at IS NULL AND redacted_at IS NULL
       GROUP BY type`,
    ),
    pool.query<{ tag: string; count: number }>(
      `SELECT tag, COUNT(*)::int AS count
       FROM my_brain_memory_metadata,
            LATERAL jsonb_array_elements_text(tags) AS tag
       WHERE forgotten_at IS NULL AND redacted_at IS NULL
       GROUP BY tag
       ORDER BY count DESC
       LIMIT 20`,
    ),
    pool.query<{ framework: string; count: number }>(
      `SELECT framework, COUNT(*)::int AS count
       FROM my_brain_memory_metadata,
            LATERAL jsonb_array_elements_text(frameworks) AS framework
       WHERE forgotten_at IS NULL AND redacted_at IS NULL
       GROUP BY framework
       ORDER BY count DESC
       LIMIT 10`,
    ),
    pool.query<{ language: string; count: number }>(
      `SELECT COALESCE(language, 'unknown') AS language, COUNT(*)::int AS count
       FROM my_brain_memory_metadata
       WHERE forgotten_at IS NULL AND redacted_at IS NULL
       GROUP BY COALESCE(language, 'unknown')
       ORDER BY count DESC
       LIMIT 10`,
    ),
  ]);

  sendJson(res, 200, {
    success: true,
    total_memories: total.rows[0]?.total_memories ?? 0,
    by_scope: Object.fromEntries(byScope.rows.map((row) => [row.scope, row.count])),
    by_type: Object.fromEntries(byType.rows.map((row) => [row.type, row.count])),
    top_tags: tags.rows,
    top_frameworks: frameworks.rows,
    top_languages: languages.rows,
    learning_stats: {
      sessions_opened: state.learning.sessionsOpened,
      sessions_closed: state.learning.sessionsClosed,
      successful_sessions: state.learning.successfulSessions,
      failed_sessions: state.learning.failedSessions,
    },
  });
}
