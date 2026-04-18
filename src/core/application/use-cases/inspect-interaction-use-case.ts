import type {
  InspectInteractionInput,
  InspectInteractionOutput,
} from '../dto/inspect-interaction-dto.js';
import type { AdaptiveBrainPort } from '../../ports/adaptive-brain-port.js';
import type { EmbeddingsPort } from '../../ports/embeddings-port.js';

/**
 * InspectInteractionUseCase replays or reuses a prior interaction so operators and
 * LLM clients can see the evidence behind retrieval decisions.
 */
export class InspectInteractionUseCase {
  /**
   * @param embeddingsPort Embeddings dependency used to replay stored queries.
   * @param adaptiveBrainPort Learning and memory dependency that owns stored interactions.
   */
  public constructor(
    private readonly embeddingsPort: EmbeddingsPort,
    private readonly adaptiveBrainPort: AdaptiveBrainPort,
  ) {}

  /**
   * Inspects one prior interaction and returns explainable evidence plus current stats.
   *
   * The use-case prefers the live adapted embedding while the interaction is
   * still buffered, because that preserves the exact query-time representation.
   * Once the interaction is no longer live, it falls back to re-embedding the
   * stored query text and excludes the inspected interaction from the returned
   * evidence so callers only see neighboring memories.
   *
   * @throws Error When `interactionId` is empty, `topK` falls outside [1, 20],
   * or the interaction is unknown to the underlying memory store.
   */
  public async execute(input: InspectInteractionInput): Promise<InspectInteractionOutput> {
    if (!input.interactionId.trim()) {
      throw new Error('interactionId must not be empty.');
    }

    if (input.topK < 1 || input.topK > 20) {
      throw new Error('topK must be between 1 and 20.');
    }

    const interaction = await this.adaptiveBrainPort.getInteractionRecord(input.interactionId);
    const bufferedEmbedding = await this.adaptiveBrainPort.getBufferedAdaptedEmbedding(
      input.interactionId,
    );
    const inspectionMode = bufferedEmbedding === undefined ? 're-embedded-query' : 'active-buffer';
    const baseEmbedding = await this.embeddingsPort.embed(interaction.queryText);
    const inspectionEmbedding = bufferedEmbedding ?? baseEmbedding;

    const matchedEvidence = await this.adaptiveBrainPort.findMatchedEvidence(
      baseEmbedding,
      input.topK,
      [input.interactionId],
    );
    const patternSummaries = await this.adaptiveBrainPort.findPatterns(
      inspectionEmbedding,
      input.topK,
    );
    const stats = await this.adaptiveBrainPort.getStats();

    return {
      interaction,
      inspectionMode,
      matchedEvidence,
      patternSummaries,
      stats,
    };
  }
}
