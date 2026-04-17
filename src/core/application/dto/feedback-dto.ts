/**
 * Input payload for feedback use-case.
 */
export interface FeedbackInput {
  /** Interaction ID returned by prior query call. */
  readonly interactionId: string;

  /** Final quality score in closed interval [0, 1]. */
  readonly qualityScore: number;

  /** Optional semantic route label for trajectory metadata. */
  readonly route?: string;

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
