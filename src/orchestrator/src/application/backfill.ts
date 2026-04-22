/**
 * Backfill use-case for healing legacy memory rows missing fingerprints or embeddings.
 *
 * The backfill operation is safe to run multiple times: it uses COALESCE so
 * existing values are never overwritten. Only rows with missing content_sha1,
 * embedding, or embedding_vector are touched.
 */

import type { Pool } from "pg";
import { asVector, contentFingerprint } from "../domain/fingerprint.js";

/**
 * Normalizes shorthand duration strings into Postgres interval-compatible literals.
 *
 * Accepted formats: `Nw` (weeks), `Nd` (days), `Nh` (hours).
 * Any unrecognized input falls back to "7 days" as a safe default.
 *
 * @param value - Raw duration input from API payload.
 * @returns Postgres-compatible interval string.
 */
export function normalizeDigestSince(value: unknown): string {
  if (typeof value !== "string") {
    return "7 days";
  }

  const normalized = value.trim().toLowerCase();
  const weekMatch = normalized.match(/^(\d{1,2})w$/);
  if (weekMatch) {
    return `${weekMatch[1]} weeks`;
  }

  const dayMatch = normalized.match(/^(\d{1,3})d$/);
  if (dayMatch) {
    return `${dayMatch[1]} days`;
  }

  const hourMatch = normalized.match(/^(\d{1,3})h$/);
  if (hourMatch) {
    return `${hourMatch[1]} hours`;
  }

  return "7 days";
}

/**
 * Result counters returned by the backfill operation.
 */
export interface BackfillResult {
  /** Total rows selected for inspection. */
  processed: number;
  /** Rows actually updated with new fingerprint or embedding values. */
  updated: number;
}

/**
 * Backfills missing fingerprints and embeddings on legacy memory rows.
 *
 * Fetches rows where content_sha1, embedding, or embedding_vector is absent,
 * computing the missing values using the provided embed function. All updates
 * use COALESCE so existing valid values are never clobbered.
 *
 * @param pool - Active Postgres pool.
 * @param batchSize - Maximum rows to process in this run.
 * @param embed - Async function that produces an embedding vector for content text.
 * @returns Counters reflecting how many rows were inspected and updated.
 */
export async function backfillMemoryMetadata(
  pool: Pool,
  batchSize: number,
  embed: (content: string) => Promise<number[]>,
): Promise<BackfillResult> {
  const selected = await pool.query<{
    memory_id: string;
    content: unknown;
    content_sha1: unknown;
    embedding: unknown;
  }>(
    `SELECT memory_id, content, content_sha1, embedding, embedding_vector
     FROM my_brain_memory_metadata
     WHERE content_sha1 IS NULL
        OR embedding IS NULL
        OR jsonb_typeof(embedding) <> 'array'
        OR embedding_vector IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize],
  );

  let updated = 0;
  for (const row of selected.rows) {
    const content = typeof row.content === "string" ? row.content : "";
    if (!content) {
      continue;
    }

    // Reuse existing fingerprint when present — never recompute what is already valid.
    const fingerprint =
      typeof row.content_sha1 === "string" && row.content_sha1.length > 0
        ? row.content_sha1
        : contentFingerprint(content);

    // Reuse existing embedding vector when parseable to avoid unnecessary API calls.
    const existingEmbedding = asVector(row.embedding);
    const embedding = existingEmbedding ?? (await embed(content));

    await pool.query(
      `UPDATE my_brain_memory_metadata
       SET content_sha1 = COALESCE(content_sha1, $2),
           embedding = CASE
             WHEN embedding IS NULL OR jsonb_typeof(embedding) <> 'array' THEN $3::jsonb
             ELSE embedding
           END,
           embedding_vector = COALESCE(embedding_vector, $4::ruvector)
       WHERE memory_id = $1`,
      [
        row.memory_id,
        fingerprint,
        JSON.stringify(embedding),
        JSON.stringify(embedding),
      ],
    );

    updated += 1;
  }

  return { processed: selected.rows.length, updated };
}
