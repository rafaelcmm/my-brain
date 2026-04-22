/**
 * Identifies the full orchestrator operating mode used by the current runtime.
 */
export const FULL_MODE = "full";

/**
 * Lists ADR-related schemas that must exist before the orchestrator can persist memory state.
 */
export const ADR_SCHEMAS = [
  "policy_memory",
  "session_memory",
  "witness_memory",
] as const;

/**
 * Enumerates the supported memory classifications accepted by write endpoints.
 */
export const MEMORY_TYPE_VALUES = [
  "decision",
  "fix",
  "convention",
  "gotcha",
  "tradeoff",
  "pattern",
  "reference",
] as const;

/**
 * Provides membership checks for supported memory classifications.
 */
export const MEMORY_TYPES = new Set<string>(MEMORY_TYPE_VALUES);

/**
 * Enumerates storage scopes that determine how broadly a memory can be recalled.
 */
export const MEMORY_SCOPE_VALUES = ["repo", "project", "global"] as const;

/**
 * Provides membership checks for supported memory scopes.
 */
export const MEMORY_SCOPES = new Set<string>(MEMORY_SCOPE_VALUES);

/**
 * Enumerates visibility levels that govern who may consume a stored memory.
 */
export const MEMORY_VISIBILITY_VALUES = ["private", "team", "public"] as const;

/**
 * Provides membership checks for supported memory visibility levels.
 */
export const MEMORY_VISIBILITY = new Set<string>(MEMORY_VISIBILITY_VALUES);

/**
 * Represents the semantic class assigned to a persisted memory.
 */
export type MemoryType = (typeof MEMORY_TYPE_VALUES)[number];

/**
 * Represents the recall scope assigned to a persisted memory.
 */
export type MemoryScope = (typeof MEMORY_SCOPE_VALUES)[number];

/**
 * Represents the audience that may consume a persisted memory.
 */
export type MemoryVisibility = (typeof MEMORY_VISIBILITY_VALUES)[number];

/**
 * Captures metadata that travels with a validated memory envelope.
 */
export interface MemoryEnvelopeMetadata {
  /** Canonical repository identifier or null when the caller cannot supply one. */
  repo: string | null;
  /** Short repository name used by ranking and digest rollups. */
  repo_name: string | null;
  /** Product or workspace label used for project-scoped recall. */
  project: string | null;
  /** Primary language hint associated with the memory content. */
  language: string | null;
  /** Framework hints used for filtering and future ranking adjustments. */
  frameworks: string[];
  /** Source path that produced the memory when one is known. */
  path: string | null;
  /** Symbol or entity name tied to the memory content. */
  symbol: string | null;
  /** Compact tag set used for optional downstream filtering. */
  tags: string[];
  /** Upstream source descriptor that explains where the memory originated. */
  source: string | null;
  /** Human author attribution when the caller provides it. */
  author: string | null;
  /** Agent identifier responsible for producing the memory. */
  agent: string | null;
  /** Original creation timestamp string when preserved from upstream. */
  created_at: string | null;
  /** Optional expiration timestamp string used for TTL workflows. */
  expires_at: string | null;
  /** Confidence score normalized to the inclusive range from 0 to 1. */
  confidence: number | null;
  /** Visibility policy enforced for the stored memory. */
  visibility: MemoryVisibility;
  /**
   * Ad-hoc fields injected during the remember flow (e.g. embedding, use_count,
   * vote_bias, last_seen_at). Typed as unknown to remain safe at the call sites
   * that read these values with explicit narrowing.
   */
  [key: string]: unknown;
}

/**
 * Represents the normalized memory payload accepted by write endpoints after validation.
 */
export interface MemoryEnvelope {
  /** User-provided memory content truncated to storage-safe bounds. */
  content: string;
  /** Semantic class that drives ranking and digest grouping. */
  type: string;
  /** Recall scope applied to the stored memory. */
  scope: string;
  /** Normalized metadata payload associated with the memory. */
  metadata: MemoryEnvelopeMetadata;
}

/**
 * Reports whether an input payload was valid and carries the normalized envelope when successful.
 */
export interface MemoryValidationResult {
  /** Signals whether the payload passed all memory contract checks. */
  valid: boolean;
  /** Explains each violated rule when validation fails. */
  errors: string[];
  /** Normalized envelope emitted only when validation succeeds. */
  envelope?: MemoryEnvelope;
}

/**
 * Describes the normalized repository identifiers derived from a remote URL.
 */
export interface ParsedRemoteRepo {
  /** Fully normalized repository path or null when no remote was available. */
  repo: string | null;
  /** Basename extracted from the normalized repository path. */
  repo_name: string | null;
}
