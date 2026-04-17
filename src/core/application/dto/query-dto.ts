import type { LearnedPattern } from '../../domain/interaction.js';

/**
 * Input payload for query use-case.
 */
export interface QueryInput {
  /** Natural language query text that should drive retrieval/learning. */
  readonly text: string;

  /** Maximum number of patterns to return for context. */
  readonly topK: number;
}

/**
 * Output payload for query use-case.
 */
export interface QueryOutput {
  /** Interaction ID required by feedback tool. */
  readonly interactionId: string;

  /** Top learned patterns for current embedding neighborhood. */
  readonly patterns: LearnedPattern[];

  /** Learning engine stats snapshot after query processing. */
  readonly stats: Record<string, unknown>;
}
