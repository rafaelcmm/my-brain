import type { AdaptiveBrainPort } from '../../ports/adaptive-brain-port.js';
import type { EmbeddingsPort } from '../../ports/embeddings-port.js';
import type { QueryInput, QueryOutput } from '../dto/query-dto.js';

/**
 * QueryUseCase handles query tool orchestration.
 *
 * Flow: embed text, register interaction, apply instant learning transform,
 * fetch nearest learned patterns, return stats for visibility.
 */
export class QueryUseCase {
  /**
   * @param embeddingsPort Outbound embeddings dependency.
   * @param adaptiveBrainPort Outbound learning/storage dependency.
   */
  public constructor(
    private readonly embeddingsPort: EmbeddingsPort,
    private readonly adaptiveBrainPort: AdaptiveBrainPort,
  ) {}

  /**
   * Executes query workflow and returns interaction metadata for feedback step.
   */
  public async execute(input: QueryInput): Promise<QueryOutput> {
    const trimmed = input.text.trim();
    if (!trimmed) {
      throw new Error('Query text must not be empty.');
    }

    if (input.topK < 1 || input.topK > 20) {
      throw new Error('topK must be between 1 and 20.');
    }

    const embedding = await this.embeddingsPort.embed(trimmed);
    const interactionId = await this.adaptiveBrainPort.beginInteraction(trimmed, embedding);

    const adapted = await this.adaptiveBrainPort.applyInstantLearning(interactionId, embedding);
    const patterns = await this.adaptiveBrainPort.findPatterns(adapted, input.topK);
    const stats = await this.adaptiveBrainPort.getStats();

    return {
      interactionId,
      patterns,
      stats,
    };
  }
}
