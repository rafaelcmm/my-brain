/**
 * Unique identifier for a memory in the system.
 */
export type MemoryId = string & { readonly __brand: "MemoryId" };

/**
 * Semantic classification of a memory (decision, fix, convention, etc.).
 */
export type MemoryType =
  | "decision"
  | "fix"
  | "convention"
  | "gotcha"
  | "tradeoff"
  | "pattern"
  | "reference";

/**
 * Recall scope: repo-scoped, project-scoped, or globally available.
 */
export type MemoryScope = "repo" | "project" | "global";

/**
 * Visibility level: private, team, or public.
 */
export type MemoryVisibility = "private" | "team" | "public";

/**
 * Metadata fields that travel with a memory.
 * Mirrors MemoryEnvelopeMetadata from orchestrator.
 */
export interface MemoryMetadata {
  /** Canonical repository identifier or null. */
  repo: string | null;
  /** Short repository name used for ranking. */
  repo_name: string | null;
  /** Product or workspace label for project-scoped recall. */
  project: string | null;
  /** Primary language hint (e.g., "typescript", "python"). */
  language: string | null;
  /** Framework hints (e.g., ["React", "Next.js"]). */
  frameworks: string[];
  /** Source path that produced the memory. */
  path: string | null;
  /** Symbol or entity name tied to the memory. */
  symbol: string | null;
  /** Compact tag set for filtering and discovery. */
  tags: string[];
  /** Upstream source descriptor (e.g., "github", "notion", "manual"). */
  source: string | null;
  /** Human author attribution. */
  author: string | null;
  /** Agent identifier responsible for producing the memory. */
  agent: string | null;
  /** Original creation timestamp (ISO 8601). */
  created_at: string | null;
  /** Optional expiration timestamp (ISO 8601). */
  expires_at: string | null;
  /** Confidence score in range [0, 1]. */
  confidence: number | null;
  /** Visibility policy. */
  visibility: MemoryVisibility;
  /** Additional dynamic fields (embedding, use_count, vote_bias, etc.). */
  [key: string]: unknown;
}

/**
 * Domain model for a persisted memory.
 */
export interface Memory {
  /** Unique identifier for this memory. */
  id: MemoryId;
  /** User-provided memory content. */
  content: string;
  /** Semantic class. */
  type: MemoryType;
  /** Recall scope. */
  scope: MemoryScope;
  /** Normalized metadata. */
  metadata: MemoryMetadata;
  /** Timestamp when memory was created in the system. */
  created_at: string;
  /** Timestamp when memory was last updated. */
  updated_at: string;
}

/**
 * Node in the knowledge graph representation.
 */
export interface GraphNode {
  /** Memory ID. */
  id: MemoryId;
  /** Memory title or content excerpt. */
  label: string;
  /** Memory type used for coloring. */
  type: MemoryType;
  /** Size proportional to use_count + vote_bias. */
  size: number;
  /** Scope for styling. */
  scope: MemoryScope;
}

/**
 * Edge connection between nodes in the knowledge graph.
 */
export interface GraphEdge {
  /** Source memory ID. */
  source: MemoryId;
  /** Target memory ID. */
  target: MemoryId;
  /** Reason for connection: "shared-repo", "shared-tags", "similarity". */
  reason: "shared-repo" | "shared-tags" | "similarity";
  /** Similarity score if reason is "similarity" [0, 1]. */
  weight?: number;
}

/**
 * Snapshot of the knowledge graph for visualization.
 */
export interface GraphSnapshot {
  /** List of all visible nodes. */
  nodes: GraphNode[];
  /** List of all computed edges. */
  edges: GraphEdge[];
  /** Total count of memories in graph. */
  total_count: number;
}

/**
 * Summary statistics of the brain.
 */
export interface BrainSummary {
  /** Total number of memories. */
  total_memories: number;
  /** Count by scope. */
  by_scope: Record<MemoryScope, number>;
  /** Count by type. */
  by_type: Record<MemoryType, number>;
  /** Top 20 tags with counts. */
  top_tags: Array<{ tag: string; count: number }>;
  /** Top 10 frameworks with counts. */
  top_frameworks: Array<{ framework: string; count: number }>;
  /** Top 10 languages with counts. */
  top_languages: Array<{ language: string; count: number }>;
  /** Learning statistics. */
  learning_stats: {
    total_recalls: number;
    total_digests: number;
    accuracy_ratio: number;
  };
}

/**
 * Request to run a query against the orchestrator.
 */
export interface QueryRequest {
  /** Query tool: "mb_recall", "mb_digest", "mb_search". */
  tool: "mb_recall" | "mb_digest" | "mb_search";
  /** Query parameters specific to the tool. */
  params: Record<string, unknown>;
}

/**
 * Response from executing a query.
 */
export interface QueryResponse {
  /** HTTP status code from orchestrator. */
  status: number;
  /** Time taken to execute (ms). */
  latency_ms: number;
  /** Parsed response payload. */
  data: unknown;
  /** Raw JSON response for inspection. */
  raw: Record<string, unknown>;
  /** Error message if status >= 400. */
  error?: string;
}
