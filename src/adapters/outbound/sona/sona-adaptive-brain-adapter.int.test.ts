import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SonaAdaptiveBrainAdapter } from './sona-adaptive-brain-adapter.js';

/**
 * Integration tests exercise real @ruvector/sona adapter lifecycle.
 */
describe('SonaAdaptiveBrainAdapter integration', () => {
  it('supports query->feedback->learn roundtrip', async () => {
    const dbPath = join(tmpdir(), `my-brain-int-${Date.now()}-${Math.random()}.db`);
    const adapter = new SonaAdaptiveBrainAdapter(8, dbPath);
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.2, 0.1, 0.5, 0.6];

    const interactionId = await adapter.beginInteraction('hello world', embedding);
    const optimized = await adapter.applyInstantLearning(interactionId, embedding);

    expect(optimized).toHaveLength(8);

    const patterns = await adapter.findPatterns(optimized, 3);
    expect(Array.isArray(patterns)).toBe(true);

    await adapter.completeInteraction(
      interactionId,
      0.9,
      'test-route',
      'Reset password from account security settings and verify MFA token.',
    );

    const learnStatus = await adapter.forceLearn();
    expect(typeof learnStatus).toBe('string');

    const stats = await adapter.getStats();
    expect(typeof stats).toBe('object');
  });

  it('does not retrieve query-only interactions as evidence', async () => {
    const dbPath = join(tmpdir(), `my-brain-int-${Date.now()}-${Math.random()}.db`);
    const adapter = new SonaAdaptiveBrainAdapter(8, dbPath);
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.2, 0.1, 0.5, 0.6];

    const queryOnlyInteractionId = await adapter.beginInteraction(
      'how change my password',
      embedding,
    );
    await adapter.completeInteraction(queryOnlyInteractionId, 1, 'seed-qa-bulk');

    const knowledgeInteractionId = await adapter.beginInteraction(
      'password reset policy answer',
      embedding,
    );
    await adapter.completeInteraction(
      knowledgeInteractionId,
      0.95,
      'seed-qa-bulk',
      'Open account security settings, run reset password, then confirm policy checks.',
    );

    const evidence = await adapter.findMatchedEvidence(embedding, 5);
    expect(evidence.some((item) => item.interactionId === queryOnlyInteractionId)).toBe(false);
    expect(evidence.some((item) => item.interactionId === knowledgeInteractionId)).toBe(true);
    expect(evidence[0]?.text).toContain('Open account security settings');
  });

  it('allows post-hoc feedback quality update for persisted evidence interaction ids', async () => {
    const dbPath = join(tmpdir(), `my-brain-int-${Date.now()}-${Math.random()}.db`);
    const adapter = new SonaAdaptiveBrainAdapter(8, dbPath);
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.2, 0.1, 0.5, 0.6];

    const interactionId = await adapter.beginInteraction('password reset policy answer', embedding);
    await adapter.completeInteraction(
      interactionId,
      0.6,
      'seed-qa-bulk',
      'Open account security settings, run reset password, then confirm policy checks.',
    );

    const evidence = await adapter.findMatchedEvidence(embedding, 1);
    const evidenceId = evidence[0]?.interactionId;

    expect(evidenceId).toBe(interactionId);

    await adapter.completeInteraction(interactionId, 0.98, 'operator-verified');

    const updated = await adapter.getInteractionRecord(interactionId);
    expect(updated.qualityScore).toBe(0.98);
    expect(updated.route).toBe('operator-verified');
    expect(updated.status).toBe('completed');
  });

  it('rejects feedback for unknown interaction id', async () => {
    const dbPath = join(tmpdir(), `my-brain-int-${Date.now()}-${Math.random()}.db`);
    const adapter = new SonaAdaptiveBrainAdapter(8, dbPath);

    await expect(
      adapter.completeInteraction('00000000-0000-4000-8000-000000000001', 0.9),
    ).rejects.toThrow('Unknown interactionId: 00000000-0000-4000-8000-000000000001');
  });
});
