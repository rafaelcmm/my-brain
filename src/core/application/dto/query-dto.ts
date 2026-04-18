import type { LearnedPattern, QueryEvidence } from '../../domain/interaction.js';

/**
 * Input payload for query use-case.
 */
export interface QueryInput {
  /** Natural language query text that should drive retrieval/learning. */
  readonly text: string;

  /** Maximum number of evidence rows and pattern summaries to return. */
  readonly topK: number;
}

/**
 * Output payload for query use-case.
 */
export interface QueryOutput {
  /** Interaction ID required by feedback tool. */
  readonly interactionId: string;

  /** Concrete memory hits that can be reasoned about directly by an LLM. */
  readonly matchedEvidence: QueryEvidence[];

  /** Top learned pattern summaries for current embedding neighborhood. */
  readonly patternSummaries: LearnedPattern[];

  /** Learning engine stats snapshot after query processing. */
  readonly stats: Record<string, unknown>;
}
