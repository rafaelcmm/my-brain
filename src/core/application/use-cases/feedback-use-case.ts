import type { AdaptiveBrainPort } from '../../ports/adaptive-brain-port.js';
import type { FeedbackInput, FeedbackOutput } from '../dto/feedback-dto.js';

/**
 * FeedbackUseCase finalizes query trajectory and optionally accelerates learning.
 */
export class FeedbackUseCase {
  /**
   * @param adaptiveBrainPort Outbound learning/storage dependency.
   */
  public constructor(private readonly adaptiveBrainPort: AdaptiveBrainPort) {}

  /**
   * Completes interaction with explicit quality signal.
   */
  public async execute(input: FeedbackInput): Promise<FeedbackOutput> {
    if (!input.interactionId.trim()) {
      throw new Error('interactionId must not be empty.');
    }

    if (input.qualityScore < 0 || input.qualityScore > 1) {
      throw new Error('qualityScore must be within [0, 1].');
    }

    await this.adaptiveBrainPort.completeInteraction(
      input.interactionId,
      input.qualityScore,
      input.route,
    );

    if (!input.forceLearnAfterFeedback) {
      return { status: 'feedback-recorded' };
    }

    const learnStatus = await this.adaptiveBrainPort.forceLearn();
    return {
      status: 'feedback-recorded-and-learned',
      learnStatus,
    };
  }
}
