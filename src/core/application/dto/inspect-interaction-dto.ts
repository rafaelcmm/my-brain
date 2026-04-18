import type { InteractionInspection } from '../../domain/interaction.js';

/**
 * Input payload for interaction inspection.
 */
export interface InspectInteractionInput {
  /** Interaction identifier previously returned by the query tool. */
  readonly interactionId: string;

  /** Maximum number of evidence items and pattern summaries to return. */
  readonly topK: number;
}

/**
 * Output payload for interaction inspection.
 */
export type InspectInteractionOutput = InteractionInspection;
