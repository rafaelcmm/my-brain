/**
 * Represents one query interaction tracked across query and feedback calls.
 *
 * This identity allows the application to correlate user feedback with the
 * exact trajectory created during query execution.
 */
export interface Interaction {
  /**
   * Stable ID returned to clients and later consumed by feedback calls.
   */
  readonly interactionId: string;

  /**
   * Original user query text used to create embeddings and learning traces.
   */
  readonly queryText: string;

  /**
   * UTC timestamp for lifecycle and observability use-cases.
   */
  readonly createdAtIso: string;
}

/**
 * Captures durable interaction metadata that explainable retrieval returns to clients.
 *
 * The record intentionally stores only semantic fields that survive process restarts
 * so operators and LLM clients can reason about prior interactions without relying
 * on transient in-memory trajectory buffers.
 */
export interface InteractionRecord {
  /** Stable identifier shared across query, feedback, and inspection flows. */
  readonly interactionId: string;

  /** Original user query text used as the human-readable retrieval artifact. */
  readonly queryText: string;

  /**
   * Classifies whether interaction produced reusable knowledge or only telemetry.
   *
   * `query-only` interactions remain inspectable but must not become retrieval evidence.
   * `knowledge-answer` interactions include validated response text suitable for reuse.
   */
  readonly learningKind: 'query-only' | 'knowledge-answer';

  /**
   * Optional knowledge payload captured during feedback when interaction is reusable.
   *
   * This field is intentionally absent for `query-only` interactions so retrieval code can
   * avoid promoting raw user questions as high-confidence memory evidence.
   */
  readonly knowledgeText?: string;

  /** UTC timestamp for when the interaction was first registered. */
  readonly createdAtIso: string;

  /** Most recent UTC timestamp when persisted interaction metadata changed. */
  readonly updatedAtIso: string;

  /** Lifecycle state so clients can distinguish pending from feedback-complete memories. */
  readonly status: 'pending' | 'completed';

  /** Optional quality score attached after feedback closes the interaction. */
  readonly qualityScore?: number;

  /** Optional route label attached during feedback for later inspection. */
  readonly route?: string;

  /** UTC timestamp for final feedback completion when available. */
  readonly completedAtIso?: string;
}

/**
 * Summarizes one learned pattern returned from the learning engine.
 */
export interface LearnedPattern {
  /** Unique pattern identifier from underlying engine. */
  readonly id: string;

  /** Mean quality score for cluster members in range [0, 1]. */
  readonly avgQuality: number;

  /** Number of trajectories represented by the pattern. */
  readonly clusterSize: number;

  /** Model-specific pattern classification label. */
  readonly patternType: string;
}

/**
 * Represents one concrete memory hit that an LLM can reason over directly.
 *
 * This shape favors compact, textual evidence instead of opaque engine-only IDs
 * so retrieval results can be consumed without an immediate follow-up tool call.
 */
export interface QueryEvidence {
  /** Stable interaction identifier for follow-up inspection or feedback correlation. */
  readonly interactionId: string;

  /** Human-readable interaction text that caused the match. */
  readonly text: string;

  /** Normalized retrieval score in range [0, 1] for ordering and rough confidence. */
  readonly score: number;

  /** Raw score returned by the vector index before normalization/clamping. */
  readonly rawScore: number;

  /** Describes which scoring system produced the numeric score. */
  readonly scoreType: 'vectorSimilarity';

  /** Compact explanation that tells clients why this memory was selected. */
  readonly whyMatched: string;

  /** Rank index assigned by vector retrieval, starting at 1 for strongest match. */
  readonly retrievalRank: number;

  /** Optional operator route label recorded during feedback. */
  readonly route?: string;

  /** Optional quality score attached to the matched interaction. */
  readonly qualityScore?: number;

  /** Creation timestamp from the matched interaction for recency reasoning. */
  readonly createdAtIso: string;

  /** Current lifecycle state of the matched interaction. */
  readonly status: InteractionRecord['status'];

  /** Indicates evidence was derived from validated knowledge payload. */
  readonly learningKind: Extract<InteractionRecord['learningKind'], 'knowledge-answer'>;
}

/**
 * Provides a debuggable view of one interaction and the memories currently associated with it.
 */
export interface InteractionInspection {
  /** Durable interaction metadata for the requested interaction. */
  readonly interaction: InteractionRecord;

  /** Indicates whether inspection used the active adapted embedding or replayed query text. */
  readonly inspectionMode: 'active-buffer' | 're-embedded-query';

  /** Concrete memory hits that best match the inspected interaction. */
  readonly matchedEvidence: QueryEvidence[];

  /** Learned pattern summaries near the inspected interaction. */
  readonly patternSummaries: LearnedPattern[];

  /** Learning engine stats captured during inspection. */
  readonly stats: Record<string, unknown>;
}
