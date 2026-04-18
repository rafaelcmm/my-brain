import { describe, expect, it } from 'vitest';
import { QueryUseCase } from './query-use-case.js';
import type { AdaptiveBrainPort } from '../../ports/adaptive-brain-port.js';
import type { EmbeddingsPort } from '../../ports/embeddings-port.js';

/**
 * Embedding test double keeps vectors deterministic so tests validate
 * orchestration contracts instead of model behavior.
 */
class FakeEmbeddingsPort implements EmbeddingsPort {
  public async embed(text: string): Promise<number[]> {
    return [text.length, 1, 0];
  }

  public getDimension(): number {
    return 3;
  }
}

/**
 * Adaptive-brain test double returns stable canned values so assertions target
 * use-case flow and output mapping.
 */
class FakeAdaptiveBrainPort implements AdaptiveBrainPort {
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
    return [{ id: 'p1', avgQuality: 0.9, clusterSize: 7, patternType: 'General' }];
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
        interactionId: '22222222-2222-4222-8222-222222222222',
        text: 'prior helpdesk unlock flow',
        score: 0.88,
        rawScore: 0.88,
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
    status: 'pending';
  }> {
    return {
      interactionId: '11111111-1111-4111-8111-111111111111',
      queryText: 'hello',
      learningKind: 'query-only',
      createdAtIso: '2026-01-01T00:00:00.000Z',
      updatedAtIso: '2026-01-01T00:00:00.000Z',
      status: 'pending',
    };
  }

  public async getBufferedAdaptedEmbedding(): Promise<number[] | undefined> {
    return [5, 1, 0];
  }

  public async forceLearn(): Promise<string> {
    return 'ok';
  }

  public async getStats(): Promise<Record<string, unknown>> {
    return { trajectories: 1 };
  }
}

/**
 * Unit tests validate query orchestration behavior without infrastructure.
 */
describe('QueryUseCase', () => {
  it('returns interaction id, matched evidence, pattern summaries, and stats', async () => {
    const useCase = new QueryUseCase(new FakeEmbeddingsPort(), new FakeAdaptiveBrainPort());

    const output = await useCase.execute({ text: 'hello', topK: 5 });

    expect(output.interactionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(output.matchedEvidence).toHaveLength(1);
    expect(output.patternSummaries).toHaveLength(1);
    expect(output.stats).toEqual({ trajectories: 1 });
  });

  it('rejects invalid topK', async () => {
    const useCase = new QueryUseCase(new FakeEmbeddingsPort(), new FakeAdaptiveBrainPort());

    await expect(useCase.execute({ text: 'hello', topK: 0 })).rejects.toThrow(
      'topK must be between 1 and 20.',
    );
  });
});
