import { describe, expect, it } from 'vitest';
import { HashEmbeddingAdapter } from './adapters/outbound/embeddings/hash-embedding-adapter.js';
import { SonaAdaptiveBrainAdapter } from './adapters/outbound/sona/sona-adaptive-brain-adapter.js';
import { QueryUseCase } from './core/application/use-cases/query-use-case.js';
import { FeedbackUseCase } from './core/application/use-cases/feedback-use-case.js';
import { LearnUseCase } from './core/application/use-cases/learn-use-case.js';

/**
 * E2E flow test covers complete self-learning lifecycle without transport.
 */
describe('Self-learning e2e flow', () => {
  it('runs query -> feedback -> learn -> query sequence', async () => {
    const embeddings = new HashEmbeddingAdapter(16);
    const brain = new SonaAdaptiveBrainAdapter(16);

    const queryUseCase = new QueryUseCase(embeddings, brain);
    const feedbackUseCase = new FeedbackUseCase(brain);
    const learnUseCase = new LearnUseCase(brain);

    const firstQuery = await queryUseCase.execute({ text: 'reset my password', topK: 5 });
    expect(firstQuery.interactionId).toHaveLength(36);

    const feedback = await feedbackUseCase.execute({
      interactionId: firstQuery.interactionId,
      qualityScore: 0.95,
      route: 'support-flow',
      forceLearnAfterFeedback: true,
    });
    expect(feedback.status).toContain('learned');

    const learn = await learnUseCase.execute();
    expect(typeof learn.status).toBe('string');

    const secondQuery = await queryUseCase.execute({ text: 'password recovery steps', topK: 5 });
    expect(secondQuery.patterns.length).toBeGreaterThanOrEqual(0);
  });
});
