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

    await adapter.completeInteraction(interactionId, 0.9, 'test-route');

    const learnStatus = await adapter.forceLearn();
    expect(typeof learnStatus).toBe('string');

    const stats = await adapter.getStats();
    expect(typeof stats).toBe('object');
  });
});
