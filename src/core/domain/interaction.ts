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
