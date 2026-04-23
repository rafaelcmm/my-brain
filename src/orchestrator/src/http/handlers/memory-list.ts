/**
 * GET /v1/memory/list — paginated metadata-backed memory listing.
 *
 * Web UI uses this endpoint for deterministic paging and filter chips.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseInteger } from "../../config/load-config.js";
import { sanitizeText } from "../../domain/memory-validation.js";

/**
 * Handles GET /v1/memory/list.
 *
 * Supported filters: scope, type, repo_name, language, tag, search.
 * Cursor is numeric offset encoded as string.
 */
export async function handleMemoryList(
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

  const requestUrl = new URL(req.url ?? "/v1/memory/list", "http://localhost");
  const scope = sanitizeText(requestUrl.searchParams.get("scope"), 16);
  const type = sanitizeText(requestUrl.searchParams.get("type"), 32);
  const repoName = sanitizeText(requestUrl.searchParams.get("repo_name"), 128);
  const language = sanitizeText(requestUrl.searchParams.get("language"), 64);
  const tag = sanitizeText(requestUrl.searchParams.get("tag"), 32);
  const search = sanitizeText(requestUrl.searchParams.get("search"), 256);

  const limit = Math.min(
    Math.max(parseInteger(requestUrl.searchParams.get("limit") ?? "25", 25), 1),
    100,
  );
  const cursor = Math.max(
    parseInteger(requestUrl.searchParams.get("cursor") ?? "0", 0),
    0,
  );

  const where: string[] = ["forgotten_at IS NULL", "redacted_at IS NULL"];
  const values: unknown[] = [];

  const pushFilter = (sql: string, value: string | null): void => {
    if (!value) {
      return;
    }
    values.push(value);
    where.push(sql.replace("$n", `$${values.length}`));
  };

  pushFilter("scope = $n", scope);
  pushFilter("type = $n", type);
  pushFilter("repo_name = $n", repoName);
  pushFilter("language = $n", language);

  if (tag) {
    values.push(JSON.stringify([tag]));
    where.push(`tags @> $${values.length}::jsonb`);
  }

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    where.push(`LOWER(content) LIKE $${values.length}`);
  }

  values.push(limit + 1, cursor);

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
      use_count
     FROM my_brain_memory_metadata
     WHERE ${where.join(" AND ")}
     ORDER BY last_seen_at DESC, created_at DESC
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values,
  );

  const hasNext = result.rows.length > limit;
  const rows = hasNext ? result.rows.slice(0, limit) : result.rows;

  sendJson(res, 200, {
    success: true,
    memories: rows.map((row) => ({
      id: row.memory_id,
      content: row.content,
      type: row.type,
      scope: row.scope,
      repo_name: row.repo_name,
      language: row.language,
      tags: Array.isArray(row.tags) ? row.tags : [],
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
      use_count: row.use_count,
    })),
    next_cursor: hasNext ? String(cursor + limit) : null,
  });
}
