/**
 * Postgres-backed memory query and persistence operations.
 *
 * All functions receive the pool as a parameter so they remain independent from
 * module-level state and testable in isolation against a real database.
 * No mocks — the project rule requires integration tests against a live
 * Postgres instance.
 *
 * Query design notes:
 * - ANN ordering via embedding_vector falls back to recency for rows still
 *   pending embedding backfill; legacy rows are surfaced after vector rows.
 * - Deduplication checks both SHA-1 fingerprint overlap AND high-similarity
 *   semantic distance to catch paraphrase duplicates the fingerprint misses.
 * - vote_bias is updated atomically on every vote so recall scoring reads a
 *   pre-computed value rather than aggregating on the hot path.
 */

import type { Pool } from "pg";
import { asVector, contentFingerprint } from "../domain/fingerprint.js";
import { sanitizeText } from "../domain/memory-validation.js";
import type { MemoryEnvelope } from "../domain/types.js";
import { similarity, voteBias } from "../domain/scoring.js";
import { normalizeRepoSelector } from "../domain/project-context.js";

/**
 * Filter parameters accepted by the recall candidate query.
 */
export interface RecallFilters {
  /** Optional scope restriction — "repo", "project", or "global". */
  scope?: string | null;
  /** Optional repository identifier resolved through normalizeRepoSelector. */
  repo?: string | null;
  /** Optional project label for project-scoped recall. */
  project?: string | null;
  /** Optional language label for language-scoped recall. */
  language?: string | null;
  /** Optional memory type for type-scoped recall. */
  type?: string | null;
  /** Optional tag set; any tag match qualifies the row. */
  tags?: string[];
  /** Optional framework set; any framework match qualifies the row. */
  frameworks?: string[];
  /** When true, expired rows are included in candidates. */
  include_expired?: boolean;
  /** When true, soft-forgotten rows are included in candidates. */
  include_forgotten?: boolean;
  /** When true, redacted rows are included in candidates. */
  include_redacted?: boolean;
}

/**
 * A raw candidate row returned by the metadata query before scoring.
 */
export interface RecallCandidate {
  memory_id: unknown;
  content: unknown;
  content_sha1: unknown;
  type: unknown;
  scope: unknown;
  repo: unknown;
  repo_name: unknown;
  project: unknown;
  language: unknown;
  frameworks: unknown;
  tags: unknown;
  embedding: unknown;
  embedding_vector: unknown;
  vote_bias: unknown;
  use_count: unknown;
  last_seen_at: unknown;
  forgotten_at: unknown;
  redacted_at: unknown;
  created_at: unknown;
  expires_at: unknown;
}

/**
 * Result returned when a duplicate memory candidate is found.
 */
export interface DuplicateMatch {
  /** Existing memory identifier that matched the new envelope. */
  memoryId: string;
  /** Similarity score that triggered the deduplication decision. */
  score: number;
  /** Match strategy: "fingerprint" (SHA-1 overlap) or "semantic" (embedding distance). */
  reason: "fingerprint" | "semantic";
}

/**
 * Vote aggregate for a single memory, including pre-computed bias.
 */
export interface VoteAggregate {
  /** Total upvote count. */
  up: number;
  /** Total downvote count. */
  down: number;
  /** Pre-computed Wilson score bias applied during recall scoring. */
  bias: number;
}

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

/**
 * Finds a duplicate memory within scoped metadata boundaries using both
 * fingerprint and semantic distance strategies.
 *
 * Fingerprint matches require SHA-1 equality AND a similarity score above the
 * engine threshold. Semantic matches apply a higher standalone threshold (0.95)
 * to avoid false positives on loosely related content.
 *
 * @param pool - Active Postgres pool.
 * @param envelope - Validated memory envelope being submitted.
 * @param embedding - Pre-computed embedding vector for the envelope content.
 * @param embeddingReady - Whether the Ollama embedding provider is available.
 * @returns The best duplicate match, or null when no duplicate is found.
 */
export async function findDuplicateMemory(
  pool: Pool,
  envelope: MemoryEnvelope,
  embedding: number[],
  embeddingReady: boolean,
): Promise<DuplicateMatch | null> {
  const metadata = envelope.metadata;
  const normalizedRepo =
    sanitizeText(metadata.repo, 256) ?? sanitizeText(metadata.repo_name, 128);

  // Lower threshold when the embedding provider is live; fallback uses a higher
  // bar to reduce false-positives from the deterministic hash embedder.
  const threshold = embeddingReady ? 0.6 : 0.85;
  const semanticThreshold = 0.95;
  const fingerprint = contentFingerprint(envelope.content);

  const candidates = await queryRecallCandidates(
    pool,
    {
      scope: envelope.scope,
      type: envelope.type,
      repo: normalizedRepo,
      include_expired: false,
      include_forgotten: false,
      include_redacted: false,
    },
    50,
  );

  let bestFingerprint: DuplicateMatch | null = null;
  let bestSemantic: DuplicateMatch | null = null;

  for (const candidate of candidates) {
    const candidateEmbedding = asVector(candidate.embedding);
    if (!candidateEmbedding) {
      continue;
    }

    const score = similarity(embedding, candidateEmbedding);

    if (candidate.content_sha1 === fingerprint && score >= threshold) {
      if (!bestFingerprint || score > bestFingerprint.score) {
        bestFingerprint = {
          memoryId: String(candidate.memory_id),
          score,
          reason: "fingerprint",
        };
      }
    }

    if (score >= semanticThreshold) {
      if (!bestSemantic || score > bestSemantic.score) {
        bestSemantic = {
          memoryId: String(candidate.memory_id),
          score,
          reason: "semantic",
        };
      }
    }
  }

  // Fingerprint match is preferred — exact SHA-1 equality is a stronger signal
  // than high embedding similarity alone.
  return bestFingerprint ?? bestSemantic;
}

/**
 * Loads aggregate vote counts and pre-computed bias for a page of memory IDs.
 *
 * Returns an empty map when the pool is unavailable or no IDs are provided.
 * The bias value passed to `voteBias` uses Wilson score lower bound so recall
 * scoring degrades gracefully for memories with few votes.
 *
 * @param pool - Active Postgres pool.
 * @param memoryIds - Memory IDs in the current recall page.
 * @returns Map from memory_id to vote aggregate including pre-computed bias.
 */
export async function loadVoteBias(
  pool: Pool,
  memoryIds: string[],
): Promise<Map<string, VoteAggregate>> {
  const result = new Map<string, VoteAggregate>();
  if (memoryIds.length === 0) {
    return result;
  }

  const queryResult = await pool.query<{
    memory_id: string;
    up: string;
    down: string;
  }>(
    `SELECT memory_id,
        SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END)::int AS up,
        SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END)::int AS down
     FROM my_brain_memory_votes
     WHERE memory_id = ANY($1::text[])
     GROUP BY memory_id`,
    [memoryIds],
  );

  for (const row of queryResult.rows) {
    const up = Number(row.up ?? 0);
    const down = Number(row.down ?? 0);
    result.set(row.memory_id, { up, down, bias: voteBias(up, down) });
  }

  return result;
}

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
