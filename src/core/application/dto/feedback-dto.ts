/**
 * Input payload for feedback use-case.
 */
export interface FeedbackInput {
  /**
   * Interaction ID to receive feedback updates.
   *
   * Accepted values are:
   * - Live query interaction IDs returned by `query`.
   * - Persisted evidence interaction IDs returned in `matchedEvidence`.
   */
  readonly interactionId: string;

  /** Final quality score in closed interval [0, 1]. */
  readonly qualityScore: number;

  /** Optional semantic route label for trajectory metadata. */
  readonly route?: string;

  /**
   * Optional validated answer payload captured as reusable knowledge evidence.
   *
   * When omitted, feedback updates quality telemetry only and keeps interaction
   * out of evidence retrieval to avoid question-only memory noise.
   */
  readonly knowledgeText?: string;

  /** Whether to trigger immediate forced learning cycle after feedback. */
  readonly forceLearnAfterFeedback: boolean;
}

/**
 * Output payload for feedback use-case.
 */
export interface FeedbackOutput {
  /** Human-readable status for operators. */
  readonly status: string;

  /** Optional learning cycle status when force flag enabled. */
  readonly learnStatus?: string;
}
