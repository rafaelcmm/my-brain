import { describe, expect, it } from 'vitest';
import { FeedbackUseCase } from './feedback-use-case.js';
import { LearnUseCase } from './learn-use-case.js';
import type { AdaptiveBrainPort } from '../../ports/adaptive-brain-port.js';

/**
 * Stateful fake captures feedback side effects so unit tests can assert
 * use-case interaction contract without real engine dependency.
 */
class FakeAdaptiveBrainPort implements AdaptiveBrainPort {
  public lastComplete: { id: string; quality: number; route?: string } | undefined;

  public async beginInteraction(): Promise<string> {
    return '11111111-1111-4111-8111-111111111111';
  }

  public async completeInteraction(
    interactionId: string,
    qualityScore: number,
    route?: string,
  ): Promise<void> {
    this.lastComplete = { id: interactionId, quality: qualityScore, route };
  }

  public async applyInstantLearning(
    _interactionId: string,
    embedding: number[],
  ): Promise<number[]> {
    return embedding;
  }

  public async findPatterns(): Promise<
    Array<{ id: string; avgQuality: number; clusterSize: number; patternType: string }>
  > {
    return [];
  }

  public async forceLearn(): Promise<string> {
    return 'forced';
  }

  public async getStats(): Promise<Record<string, unknown>> {
    return { background_cycles: 1 };
  }
}

/**
 * Unit tests for feedback and learn use-cases.
 */
describe('FeedbackUseCase and LearnUseCase', () => {
  it('records feedback and optionally forces learning', async () => {
    const port = new FakeAdaptiveBrainPort();
    const useCase = new FeedbackUseCase(port);

    const output = await useCase.execute({
      interactionId: '11111111-1111-4111-8111-111111111111',
      qualityScore: 0.8,
      route: 'router-a',
      forceLearnAfterFeedback: true,
    });

    expect(port.lastComplete).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      quality: 0.8,
      route: 'router-a',
    });
    expect(output.status).toBe('feedback-recorded-and-learned');
    expect(output.learnStatus).toBe('forced');
  });

  it('returns learn status and stats', async () => {
    const port = new FakeAdaptiveBrainPort();
    const useCase = new LearnUseCase(port);

    const output = await useCase.execute();

    expect(output.status).toBe('forced');
    expect(output.stats).toEqual({ background_cycles: 1 });
  });
});
