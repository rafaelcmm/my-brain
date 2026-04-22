import type { Pool } from "pg";
import { asVector, contentFingerprint } from "../../domain/fingerprint.js";
import { sanitizeText } from "../../domain/memory-validation.js";
import { similarity } from "../../domain/scoring.js";
import type { MemoryEnvelope } from "../../domain/types.js";
import type { DuplicateMatch } from "./types.js";
import { queryRecallCandidates } from "./recall-query.js";

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
