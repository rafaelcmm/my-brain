import type { Pool } from "pg";
import { asVector, contentFingerprint } from "../../domain/fingerprint.js";
import type { MemoryEnvelope } from "../../domain/types.js";

/**
 * Persists a sidecar metadata row for a newly remembered memory using upsert.
 *
 * The INSERT … ON CONFLICT DO UPDATE strategy ensures that repeated remember
 * calls for the same memory_id converge rather than error — important during
 * retry flows where the engine succeeds but a downstream step fails.
 *
 * Uses COALESCE on created_at and last_seen_at so historically imported memories
 * can preserve their original timestamps when the caller supplies them.
 *
 * @param pool - Active Postgres pool.
 * @param memoryId - Stable identifier returned by the intelligence engine.
 * @param envelope - Validated memory envelope with all metadata fields populated.
 * @returns Resolves when the row is confirmed persisted.
 */
export async function persistMemoryMetadata(
  pool: Pool,
  memoryId: string,
  envelope: MemoryEnvelope,
): Promise<void> {
  const metadata = envelope.metadata;
  const frameworks = Array.isArray(metadata.frameworks)
    ? metadata.frameworks
    : [];
  const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
  const fingerprint = contentFingerprint(envelope.content);

  // Metadata carries the embedding vector injected by the remember handler
  // before this function is called.
  const rawEmbedding = metadata["embedding"];
  const embedding = asVector(rawEmbedding);

  const rawUseCount = metadata["use_count"];
  const useCount =
    typeof rawUseCount === "number" && Number.isInteger(rawUseCount)
      ? Math.max(rawUseCount, 1)
      : 1;

  await pool.query(
    `INSERT INTO my_brain_memory_metadata (
      memory_id,
      content,
      content_sha1,
      embedding,
      embedding_vector,
      type,
      scope,
      repo,
      repo_name,
      project,
      language,
      frameworks,
      path,
      symbol,
      tags,
      source,
      author,
      agent,
      created_at,
      expires_at,
      forgotten_at,
      redacted_at,
      use_count,
      last_seen_at,
      confidence,
      vote_bias,
      visibility,
      metadata
    ) VALUES (
      $1, $2, $3, $4::jsonb, $5::ruvector, $6, $7, $8, $9, $10,
      $11, $12::jsonb, $13, $14, $15::jsonb, $16, $17, $18,
      COALESCE($19::timestamptz, NOW()), $20::timestamptz, $21::timestamptz,
      $22::timestamptz, $23, COALESCE($24::timestamptz, NOW()), $25, $26, $27, $28::jsonb
    )
    ON CONFLICT (memory_id) DO UPDATE SET
      content = EXCLUDED.content,
      content_sha1 = EXCLUDED.content_sha1,
      embedding = EXCLUDED.embedding,
      embedding_vector = EXCLUDED.embedding_vector,
      type = EXCLUDED.type,
      scope = EXCLUDED.scope,
      repo = EXCLUDED.repo,
      repo_name = EXCLUDED.repo_name,
      project = EXCLUDED.project,
      language = EXCLUDED.language,
      frameworks = EXCLUDED.frameworks,
      path = EXCLUDED.path,
      symbol = EXCLUDED.symbol,
      tags = EXCLUDED.tags,
      source = EXCLUDED.source,
      author = EXCLUDED.author,
      agent = EXCLUDED.agent,
      created_at = EXCLUDED.created_at,
      expires_at = EXCLUDED.expires_at,
      forgotten_at = EXCLUDED.forgotten_at,
      redacted_at = EXCLUDED.redacted_at,
      use_count = EXCLUDED.use_count,
      last_seen_at = EXCLUDED.last_seen_at,
      confidence = EXCLUDED.confidence,
      vote_bias = EXCLUDED.vote_bias,
      visibility = EXCLUDED.visibility,
      metadata = EXCLUDED.metadata`,
    [
      memoryId,
      envelope.content,
      fingerprint,
      JSON.stringify(embedding ?? []),
      embedding && embedding.length > 0 ? JSON.stringify(embedding) : null,
      envelope.type,
      envelope.scope,
      metadata.repo,
      metadata.repo_name,
      metadata.project,
      metadata.language,
      JSON.stringify(frameworks),
      metadata.path,
      metadata.symbol,
      JSON.stringify(tags),
      metadata.source,
      metadata.author,
      metadata.agent,
      metadata["created_at"],
      metadata["expires_at"],
      metadata["forgotten_at"],
      metadata["redacted_at"],
      useCount,
      metadata["last_seen_at"],
      metadata.confidence,
      typeof metadata["vote_bias"] === "number" ? metadata["vote_bias"] : 0,
      metadata.visibility,
      JSON.stringify(metadata),
    ],
  );
}
