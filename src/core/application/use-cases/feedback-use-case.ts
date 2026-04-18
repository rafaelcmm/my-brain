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
   * Records terminal feedback for one interaction and optionally triggers an immediate
   * learning cycle so new signal becomes query-visible without waiting for background cadence.
   *
   * @param input Feedback payload tied to a previously issued interaction ID.
   * @returns feedback-recorded when only persistence succeeds, or
   * feedback-recorded-and-learned when forced learning is requested and executed.
   * @throws Error when interactionId is blank.
   * @throws Error when qualityScore is outside [0, 1].
   * @throws Error when knowledgeText is provided but empty after trimming.
   */
  public async execute(input: FeedbackInput): Promise<FeedbackOutput> {
    if (!input.interactionId.trim()) {
      throw new Error('interactionId must not be empty.');
    }

    if (input.qualityScore < 0 || input.qualityScore > 1) {
      throw new Error('qualityScore must be within [0, 1].');
    }

    const knowledgeText = input.knowledgeText?.trim();
    if (input.knowledgeText !== undefined && !knowledgeText) {
      throw new Error('knowledgeText must not be empty when provided.');
    }

    await this.adaptiveBrainPort.completeInteraction(
      input.interactionId,
      input.qualityScore,
      input.route,
      knowledgeText,
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
