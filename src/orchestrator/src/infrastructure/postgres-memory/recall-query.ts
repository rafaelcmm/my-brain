import type { Pool } from "pg";
import { normalizeRepoSelector } from "../../domain/project-context.js";
import type { RecallCandidate, RecallFilters } from "./types.js";

/**
 * Runs metadata-first candidate selection for scoped recall.
 *
 * Applies filter clauses from the supplied filters object, then orders by
 * vector proximity when a query embedding is supplied. Falls back to recency
 * ordering for rows with a null embedding_vector so legacy rows are not silently
 * dropped from results.
 *
 * @param pool - Active Postgres pool.
 * @param filters - Recall filter parameters applied as WHERE clauses.
 * @param limit - Maximum number of candidate rows to return.
 * @param queryEmbedding - Optional query vector used for ANN ordering.
 * @returns Array of raw metadata rows ready for scoring.
 */
export async function queryRecallCandidates(
  pool: Pool,
  filters: RecallFilters,
  limit: number,
  queryEmbedding: number[] | null = null,
): Promise<RecallCandidate[]> {
  const clauses: string[] = ["1 = 1"];
  const values: unknown[] = [];

  const pushValue = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (typeof filters.scope === "string") {
    clauses.push(`scope = ${pushValue(filters.scope)}`);
  }

  if (typeof filters.repo === "string") {
    const variants = normalizeRepoSelector(filters.repo);
    if (variants.length > 0) {
      clauses.push(
        `(repo = ANY(${pushValue(variants)}::text[]) OR repo_name = ANY(${pushValue(variants)}::text[]))`,
      );
    }
  }

  if (typeof filters.project === "string") {
    clauses.push(`project = ${pushValue(filters.project)}`);
  }

  if (typeof filters.language === "string") {
    clauses.push(`language = ${pushValue(filters.language)}`);
  }

  if (typeof filters.type === "string") {
    clauses.push(`type = ${pushValue(filters.type)}`);
  }

  if (!filters.include_expired) {
    clauses.push("(expires_at IS NULL OR expires_at > NOW())");
  }

  if (!filters.include_forgotten) {
    clauses.push("forgotten_at IS NULL");
  }

  if (!filters.include_redacted) {
    clauses.push("redacted_at IS NULL");
  }

  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(tags) AS tag
        WHERE tag = ANY(${pushValue(filters.tags)}::text[])
      )`,
    );
  }

  if (Array.isArray(filters.frameworks) && filters.frameworks.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(frameworks) AS framework
        WHERE framework = ANY(${pushValue(filters.frameworks)}::text[])
      )`,
    );
  }

  const embeddingLiteral =
    Array.isArray(queryEmbedding) && queryEmbedding.length > 0
      ? JSON.stringify(queryEmbedding)
      : null;

  // ANN-friendly ordering: vector rows first by cosine distance, then recency
  // fallback for rows awaiting embedding backfill.
  let orderBy = "created_at DESC";
  if (embeddingLiteral) {
    orderBy = `
      CASE WHEN embedding_vector IS NULL THEN 1 ELSE 0 END,
      embedding_vector <=> ${pushValue(embeddingLiteral)}::ruvector,
      created_at DESC`;
  }

  values.push(limit);

  const result = await pool.query<RecallCandidate>(
    `SELECT
      memory_id,
      content,
      content_sha1,
      type,
      scope,
      repo,
      repo_name,
      project,
      language,
      frameworks,
      tags,
      embedding,
      embedding_vector,
      vote_bias,
      use_count,
      last_seen_at,
      forgotten_at,
      redacted_at,
      created_at,
      expires_at
    FROM my_brain_memory_metadata
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $${values.length}`,
    values,
  );

  return result.rows;
}
