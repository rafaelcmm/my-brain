import { describe, expect, it } from 'vitest';
import { InspectInteractionUseCase } from './inspect-interaction-use-case.js';
import type { AdaptiveBrainPort } from '../../ports/adaptive-brain-port.js';
import type { EmbeddingsPort } from '../../ports/embeddings-port.js';

/**
 * Embedding test double keeps inspection replay deterministic and free from model downloads.
 */
class FakeEmbeddingsPort implements EmbeddingsPort {
  public async embed(text: string): Promise<number[]> {
    return [text.length, 2, 0];
  }

  public getDimension(): number {
    return 3;
  }
}

/**
 * Adaptive-brain fake exposes both buffered and durable interaction paths so inspection
 * tests can verify active-buffer reuse and replay fallback behavior.
 */
class FakeAdaptiveBrainPort implements AdaptiveBrainPort {
  public useBufferedEmbedding = true;

  public async beginInteraction(): Promise<string> {
    return '11111111-1111-4111-8111-111111111111';
  }

  public async completeInteraction(): Promise<void> {
    return;
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
    return [{ id: 'p1', avgQuality: 0.91, clusterSize: 4, patternType: 'General' }];
  }

  public async findMatchedEvidence(): Promise<
    Array<{
      interactionId: string;
      text: string;
      score: number;
      rawScore: number;
      scoreType: 'vectorSimilarity';
      whyMatched: string;
      retrievalRank: number;
      createdAtIso: string;
      status: 'completed';
      learningKind: 'knowledge-answer';
    }>
  > {
    return [
      {
        interactionId: '33333333-3333-4333-8333-333333333333',
        text: 'reset lockout counter manually',
        score: 0.79,
        rawScore: 0.79,
        scoreType: 'vectorSimilarity',
        whyMatched: 'Nearest stored interaction.',
        retrievalRank: 1,
        createdAtIso: '2026-01-01T00:00:00.000Z',
        status: 'completed',
        learningKind: 'knowledge-answer',
      },
    ];
  }

  public async getInteractionRecord(): Promise<{
    interactionId: string;
    queryText: string;
    learningKind: 'query-only';
    createdAtIso: string;
    updatedAtIso: string;
    status: 'completed';
    qualityScore: number;
  }> {
    return {
      interactionId: '11111111-1111-4111-8111-111111111111',
      queryText: 'unlock locked account',
      learningKind: 'query-only',
      createdAtIso: '2026-01-01T00:00:00.000Z',
      updatedAtIso: '2026-01-01T00:00:00.000Z',
      status: 'completed',
      qualityScore: 0.8,
    };
  }

  public async getBufferedAdaptedEmbedding(): Promise<number[] | undefined> {
    return this.useBufferedEmbedding ? [9, 1, 0] : undefined;
  }

  public async forceLearn(): Promise<string> {
    return 'forced';
  }

  public async getStats(): Promise<Record<string, unknown>> {
    return { inspected: true };
  }
}

/**
 * Unit tests validate inspection behavior independently from transport and SONA runtime.
 */
describe('InspectInteractionUseCase', () => {
  it('reuses active buffered embedding when available', async () => {
    const port = new FakeAdaptiveBrainPort();
    const useCase = new InspectInteractionUseCase(new FakeEmbeddingsPort(), port);

    const output = await useCase.execute({
      interactionId: '11111111-1111-4111-8111-111111111111',
      topK: 3,
    });

    expect(output.inspectionMode).toBe('active-buffer');
    expect(output.matchedEvidence).toHaveLength(1);
    expect(output.patternSummaries).toHaveLength(1);
  });

  it('replays query text when live buffer is unavailable', async () => {
    const port = new FakeAdaptiveBrainPort();
    port.useBufferedEmbedding = false;
    const useCase = new InspectInteractionUseCase(new FakeEmbeddingsPort(), port);

    const output = await useCase.execute({
      interactionId: '11111111-1111-4111-8111-111111111111',
      topK: 3,
    });

    expect(output.inspectionMode).toBe('re-embedded-query');
  });
});
