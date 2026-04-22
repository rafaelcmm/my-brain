/**
 * Scoring orchestration for POST /v1/memory/recall candidates.
 *
 * Combines semantic similarity, lexical boost, and vote bias for each DB
 * candidate to produce a final ranked list. Splitting this out of the main
 * handler allows the scoring pipeline to be unit-tested in isolation without
 * standing up an HTTP server.
 */

import type { Pool } from "pg";
import { asVector } from "../../domain/fingerprint.js";
import { lexicalBoost, similarity } from "../../domain/scoring.js";
import { loadVoteBias } from "../../infrastructure/postgres-memory.js";

/** Row shape returned by `queryRecallCandidates`. */
export interface RecallCandidate {
  memory_id: unknown;
  content: unknown;
  type: unknown;
  scope: unknown;
  embedding: unknown;
  vote_bias: unknown;
  repo: unknown;
  repo_name: unknown;
  project: unknown;
  language: unknown;
  frameworks: unknown;
  tags: unknown;
  created_at: unknown;
  expires_at: unknown;
  forgotten_at: unknown;
  redacted_at: unknown;
  use_count: unknown;
  last_seen_at: unknown;
}

/**
 * A fully scored memory result ready for JSON serialization.
 *
 * Scores are rounded to three decimal places for response payload
 * compactness; the raw `score` value is used for sorting and threshold
 * filtering before rounding.
 */
export interface ScoredResult {
  id: unknown;
  content: string;
  type: unknown;
  scope: unknown;
  semantic_score: number;
  lexical_score: number;
  vote_bias: number;
  score: number;
  metadata: {
    repo: unknown;
    repo_name: unknown;
    project: unknown;
    language: unknown;
    frameworks: unknown;
    tags: unknown;
    created_at: unknown;
    expires_at: unknown;
    forgotten_at: unknown;
    redacted_at: unknown;
    use_count: unknown;
    last_seen_at: unknown;
    votes_up: number;
    votes_down: number;
  };
}

/**
 * Dependencies injected into the scoring pipeline.
 *
 * Accepting a `getCachedEmbedding` function rather than a concrete client
 * keeps the scoring module decoupled from the embedding infrastructure.
 */
export interface ScoringDeps {
  pool: Pool | null;
  getCachedEmbedding: (text: string) => Promise<number[]>;
}

/**
 * Scores, filters, and ranks recall candidates by combined signal.
 *
 * Algorithm per candidate:
 *   1. Retrieve stored embedding or re-embed content via `getCachedEmbedding`.
 *   2. Cosine similarity between query and content embeddings → semantic score.
 *   3. Token overlap between query and raw text → lexical boost.
 *   4. Add vote bias from the votes table (positive = trusted, negative = downvoted).
 *   5. Clamp composite score to [0, 1].
 *
 * Results below `minScore` are discarded before returning `topK` items sorted
 * descending by composite score.
 *
 * @param candidates - Raw DB rows from `queryRecallCandidates`.
 * @param query - Original query string used for lexical comparison.
 * @param queryEmbedding - Embedding vector for the query.
 * @param topK - Maximum number of results to return.
 * @param minScore - Minimum composite score gate.
 * @param deps - Injected pool and embedding helpers.
 * @returns Ranked, filtered, serialization-ready result list.
 */
export async function scoreAndRankCandidates(
  candidates: RecallCandidate[],
  query: string,
  queryEmbedding: number[],
  topK: number,
  minScore: number,
  deps: ScoringDeps,
): Promise<ScoredResult[]> {
  const { pool, getCachedEmbedding } = deps;

  const memoryIds = candidates.map((c) => String(c.memory_id));
  const voteByMemoryId =
    pool !== null && memoryIds.length > 0
      ? await loadVoteBias(pool, memoryIds)
      : new Map<string, { up: number; down: number; bias: number }>();

  const scored = candidates.map(async (candidate): Promise<ScoredResult> => {
    const content =
      typeof candidate.content === "string" ? candidate.content : "";
    const storedEmbedding = asVector(candidate.embedding);
    const contentEmbedding =
      storedEmbedding ?? (await getCachedEmbedding(content));
    const semanticScore = similarity(queryEmbedding, contentEmbedding);
    const lexicalScore = lexicalBoost(query, content);
    const votes = voteByMemoryId.get(String(candidate.memory_id)) ?? {
      up: 0,
      down: 0,
      bias: Number(candidate.vote_bias ?? 0),
    };
    const score = Math.max(
      0,
      Math.min(1, semanticScore + lexicalScore + Number(votes.bias ?? 0)),
    );
    return {
      id: candidate.memory_id,
      content,
      type: candidate.type,
      scope: candidate.scope,
      semantic_score: Number(semanticScore.toFixed(3)),
      lexical_score: Number(lexicalScore.toFixed(3)),
      vote_bias: Number(Number(votes.bias ?? 0).toFixed(3)),
      score,
      metadata: {
        repo: candidate.repo,
        repo_name: candidate.repo_name,
        project: candidate.project,
        language: candidate.language,
        frameworks: candidate.frameworks,
        tags: candidate.tags,
        created_at: candidate.created_at,
        expires_at: candidate.expires_at,
        forgotten_at: candidate.forgotten_at,
        redacted_at: candidate.redacted_at,
        use_count: candidate.use_count,
        last_seen_at: candidate.last_seen_at,
        votes_up: votes.up,
        votes_down: votes.down,
      },
    };
  });

  const resolved = await Promise.all(scored);
  return resolved
    .filter((e) => typeof e.score === "number" && e.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((e) => ({ ...e, score: Number(e.score.toFixed(3)) }));
}
