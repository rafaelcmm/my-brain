/**
 * GET /v1/memory/graph — light graph snapshot for visualization.
 *
 * Graph derives from metadata relationships only (repo + tags) so endpoint
 * remains fast and does not require expensive pairwise embedding distance.
 */

import type http from "node:http";
import type { RouterContext } from "../router-context.js";
import { sendJson } from "../response.js";
import { parseInteger } from "../../config/load-config.js";

interface GraphNodeRow {
  memory_id: string;
  content: string;
  type: string;
  scope: string;
  repo_name: string | null;
  tags: unknown;
  use_count: number;
  vote_bias: number;
}

/**
 * Handles GET /v1/memory/graph.
 */
export async function handleMemoryGraph(
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

  const requestUrl = new URL(req.url ?? "/v1/memory/graph", "http://localhost");
  const limit = Math.min(
    Math.max(
      parseInteger(requestUrl.searchParams.get("limit") ?? "120", 120),
      10,
    ),
    300,
  );

  const totalResult = await pool.query<{ total_count: number }>(
    `SELECT COUNT(*)::int AS total_count
     FROM my_brain_memory_metadata
     WHERE forgotten_at IS NULL AND redacted_at IS NULL`,
  );

  const rows = await pool.query<GraphNodeRow>(
    `SELECT
      memory_id,
      content,
      type,
      scope,
      repo_name,
      tags,
      use_count,
      vote_bias
     FROM my_brain_memory_metadata
     WHERE forgotten_at IS NULL AND redacted_at IS NULL
     ORDER BY last_seen_at DESC
     LIMIT $1`,
    [limit],
  );

  const nodes = rows.rows.map((row) => ({
    id: row.memory_id,
    label:
      row.content.length > 96 ? `${row.content.slice(0, 96)}...` : row.content,
    type: row.type,
    scope: row.scope,
    size: Math.max(1, row.use_count + (row.vote_bias > 0 ? 1 : 0)),
    repo_name: row.repo_name,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag) => typeof tag === "string")
      : [],
  }));

  const edges: Array<{
    source: string;
    target: string;
    reason: "shared-repo" | "shared-tags";
    weight: number;
  }> = [];

  // Pairwise relation building is bounded by endpoint limit (<=300), so this
  // stays cheap while still providing meaningful graph neighborhoods.
  for (let i = 0; i < nodes.length; i += 1) {
    const left = nodes[i];
    if (!left) {
      continue;
    }

    for (let j = i + 1; j < nodes.length; j += 1) {
      const right = nodes[j];
      if (!right) {
        continue;
      }

      if (
        left.repo_name &&
        right.repo_name &&
        left.repo_name === right.repo_name
      ) {
        edges.push({
          source: left.id,
          target: right.id,
          reason: "shared-repo",
          weight: 0.8,
        });
        continue;
      }

      const leftTags = new Set(left.tags as string[]);
      const overlap = (right.tags as string[]).filter((tag) =>
        leftTags.has(tag),
      ).length;
      if (overlap > 0) {
        edges.push({
          source: left.id,
          target: right.id,
          reason: "shared-tags",
          weight: Math.min(1, 0.35 + overlap * 0.2),
        });
      }
    }
  }

  sendJson(res, 200, {
    success: true,
    total_count: totalResult.rows[0]?.total_count ?? 0,
    nodes: nodes.map(({ repo_name: _repoName, tags: _tags, ...node }) => node),
    edges: edges.slice(0, 1200),
  });
}
