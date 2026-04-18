import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SonaAdaptiveBrainAdapter } from './adapters/outbound/sona/sona-adaptive-brain-adapter.js';
import { QueryUseCase } from './core/application/use-cases/query-use-case.js';
import { FeedbackUseCase } from './core/application/use-cases/feedback-use-case.js';
import { InspectInteractionUseCase } from './core/application/use-cases/inspect-interaction-use-case.js';
import { LearnUseCase } from './core/application/use-cases/learn-use-case.js';
import type { EmbeddingsPort } from './core/ports/embeddings-port.js';

/**
 * Deterministic test embeddings keep this e2e flow lightweight while preserving
 * semantic-like token grouping behavior for similarity checks.
 */
class DeterministicTestEmbeddingAdapter implements EmbeddingsPort {
  public constructor(private readonly dimension: number) {}

  public async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimension).fill(0);
    for (const token of text.toLowerCase().split(/\s+/)) {
      if (!token) {
        continue;
      }

      const bucket = token.charCodeAt(0) % this.dimension;
      vector[bucket] += 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm === 0 ? vector : vector.map((value) => value / norm);
  }

  public getDimension(): number {
    return this.dimension;
  }
}

/**
 * E2E flow test covers complete self-learning lifecycle without transport.
 */
describe('Self-learning e2e flow', () => {
  it('runs query -> feedback -> learn -> query sequence', async () => {
    const embeddings = new DeterministicTestEmbeddingAdapter(16);
    const dbPath = join(tmpdir(), `my-brain-e2e-${Date.now()}-${Math.random()}.db`);
    const brain = new SonaAdaptiveBrainAdapter(16, dbPath);

    const queryUseCase = new QueryUseCase(embeddings, brain);
    const feedbackUseCase = new FeedbackUseCase(brain);
    const inspectInteractionUseCase = new InspectInteractionUseCase(embeddings, brain);
    const learnUseCase = new LearnUseCase(brain);

    const firstQuery = await queryUseCase.execute({ text: 'reset my password', topK: 5 });
    expect(firstQuery.interactionId).toHaveLength(36);

    const feedback = await feedbackUseCase.execute({
      interactionId: firstQuery.interactionId,
      qualityScore: 0.95,
      route: 'support-flow',
      knowledgeText:
        'Open account security settings, execute password reset, and verify tenant policy guardrails.',
      forceLearnAfterFeedback: true,
    });
    expect(feedback.status).toContain('learned');

    const learn = await learnUseCase.execute();
    expect(typeof learn.status).toBe('string');

    const inspection = await inspectInteractionUseCase.execute({
      interactionId: firstQuery.interactionId,
      topK: 5,
    });
    expect(inspection.interaction.interactionId).toBe(firstQuery.interactionId);

    const secondQuery = await queryUseCase.execute({ text: 'password recovery steps', topK: 5 });
    expect(secondQuery.matchedEvidence.length).toBeGreaterThanOrEqual(1);
    expect(secondQuery.matchedEvidence[0]?.learningKind).toBe('knowledge-answer');
    expect(secondQuery.patternSummaries.length).toBeGreaterThanOrEqual(0);
  });
});
