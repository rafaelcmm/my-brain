/**
 * Shared contracts for Postgres-backed memory persistence and recall.
 */

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
