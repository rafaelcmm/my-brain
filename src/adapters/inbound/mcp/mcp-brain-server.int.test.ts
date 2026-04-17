import { describe, expect, it } from 'vitest';
import { McpBrainServer } from './mcp-brain-server.js';
import { QueryUseCase } from '../../../core/application/use-cases/query-use-case.js';
import { FeedbackUseCase } from '../../../core/application/use-cases/feedback-use-case.js';
import { LearnUseCase } from '../../../core/application/use-cases/learn-use-case.js';
import type { EmbeddingsPort } from '../../../core/ports/embeddings-port.js';
import type { AdaptiveBrainPort } from '../../../core/ports/adaptive-brain-port.js';

/**
 * Deterministic embedding double keeps MCP integration test isolated from
 * external model runtime and cache side effects.
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
 * Adaptive-brain fake exercises MCP contract mapping without requiring native
 * SONA calls during this adapter-level integration test.
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

  public async forceLearn(): Promise<string> {
    return 'forced';
  }

  public async getStats(): Promise<Record<string, unknown>> {
    return { trajectories: 1 };
  }
}

/**
 * Integration tests validate MCP adapter behavior independent from transport.
 */
describe('McpBrainServer integration', () => {
  it('exposes query feedback learn execution hooks', async () => {
    const embeddings = new FakeEmbeddingsPort();
    const brain = new FakeAdaptiveBrainPort();

    const server = new McpBrainServer(
      'test-server',
      '0.1.0',
      new QueryUseCase(embeddings, brain),
      new FeedbackUseCase(brain),
      new LearnUseCase(brain),
    );

    const query = await server.executeQueryTool('hello', 3);
    expect(query.interactionId).toBe('11111111-1111-4111-8111-111111111111');

    const feedback = await server.executeFeedbackTool(
      '11111111-1111-4111-8111-111111111111',
      0.7,
      undefined,
      true,
    );
    expect(feedback.status).toBe('feedback-recorded-and-learned');

    const learn = await server.executeLearnTool();
    expect(learn.status).toBe('forced');
  });
});
