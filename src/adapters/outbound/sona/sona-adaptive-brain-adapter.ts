import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { promises as fs } from 'node:fs';
import { SonaEngine, type JsLearnedPattern } from '@ruvector/sona';
import { z } from 'zod';
import type { AdaptiveBrainPort } from '../../../core/ports/adaptive-brain-port.js';
import type { LearnedPattern } from '../../../core/domain/interaction.js';

interface InteractionBuffer {
  readonly queryText: string;
  readonly embedding: number[];
  readonly trajectoryId: number;
}

interface PersistedLearningEvent {
  readonly queryText: string;
  readonly embedding: number[];
  readonly qualityScore: number;
  readonly route?: string;
}

/**
 * Build-time schema factory is required because embedding length is dynamic.
 */
const persistedLearningEventSchema = (embeddingDim: number): z.ZodType<PersistedLearningEvent> =>
  z.object({
    queryText: z.string().min(1).max(10_000),
    embedding: z.array(z.number()).length(embeddingDim),
    qualityScore: z.number().min(0).max(1),
    route: z.string().max(100).optional(),
  });

/**
 * SonaAdaptiveBrainAdapter bridges core learning port to @ruvector/sona engine.
 *
 * Adapter stores interactionId -> trajectoryId map in-process so feedback can
 * close trajectories safely. For distributed setup this map can move to external
 * store without changing application use-cases.
 */
export class SonaAdaptiveBrainAdapter implements AdaptiveBrainPort {
  private readonly interactionToTrajectory = new Map<string, number>();
  private readonly interactionBuffer = new Map<string, InteractionBuffer>();
  private readonly engine: SonaEngine;
  private readonly initialized: Promise<void>;

  /**
   * @param embeddingDim Embedding dimensionality expected by engine.
   * @param eventsFilePath File path used for append-only learning events.
   */
  public constructor(
    private readonly embeddingDim: number,
    private readonly eventsFilePath = '.data/sona-events.ndjson',
  ) {
    this.engine = SonaEngine.withConfig({
      hiddenDim: embeddingDim,
      embeddingDim,
      microLoraRank: 2,
      baseLoraRank: 16,
      microLoraLr: 0.002,
      qualityThreshold: 0.3,
      patternClusters: 100,
      ewcLambda: 2000,
    });
    this.initialized = this.initializeFromDisk();
  }

  /**
   * Begins SONA trajectory and returns externally-visible interaction ID.
   */
  public async beginInteraction(queryText: string, embedding: number[]): Promise<string> {
    await this.initialized;
    this.assertEmbedding(embedding);

    const trajectoryId = this.engine.beginTrajectory(embedding);
    const interactionId = randomUUID();

    this.engine.addTrajectoryContext(trajectoryId, queryText.slice(0, 256));
    this.interactionToTrajectory.set(interactionId, trajectoryId);
    this.interactionBuffer.set(interactionId, {
      queryText,
      embedding,
      trajectoryId,
    });

    return interactionId;
  }

  /**
   * Finalizes trajectory with quality signal and optional route label.
   */
  public async completeInteraction(
    interactionId: string,
    qualityScore: number,
    route?: string,
  ): Promise<void> {
    await this.initialized;
    const trajectoryId = this.interactionToTrajectory.get(interactionId);
    const buffer = this.interactionBuffer.get(interactionId);
    if (trajectoryId === undefined) {
      throw new Error(`Unknown interactionId: ${interactionId}`);
    }
    if (!buffer) {
      throw new Error(`Missing buffered interaction data for ${interactionId}`);
    }

    if (route) {
      this.engine.setTrajectoryRoute(trajectoryId, route);
    }

    this.engine.endTrajectory(trajectoryId, qualityScore);
    await this.appendEvent({
      queryText: buffer.queryText,
      embedding: buffer.embedding,
      qualityScore,
      route,
    });

    this.interactionToTrajectory.delete(interactionId);
    this.interactionBuffer.delete(interactionId);
  }

  /**
   * Applies micro-LoRA online adaptation and records lightweight trace step.
   */
  public async applyInstantLearning(interactionId: string, embedding: number[]): Promise<number[]> {
    await this.initialized;
    this.assertEmbedding(embedding);
    const trajectoryId = this.interactionToTrajectory.get(interactionId);
    if (trajectoryId === undefined) {
      throw new Error(`Unknown interactionId: ${interactionId}`);
    }

    const adapted = this.engine.applyMicroLora(embedding);
    const attention = this.buildUniformAttention(64);
    this.engine.addTrajectoryStep(
      trajectoryId,
      adapted.map((value) => Math.tanh(value)),
      attention,
      0.8,
    );

    return adapted;
  }

  /**
   * Returns nearest learned pattern summaries.
   */
  public async findPatterns(embedding: number[], limit: number): Promise<LearnedPattern[]> {
    await this.initialized;
    this.assertEmbedding(embedding);

    const patterns = this.engine.findPatterns(embedding, limit);
    return patterns.map((pattern) => this.toLearnedPattern(pattern));
  }

  /**
   * Forces background learning cycle.
   */
  public async forceLearn(): Promise<string> {
    await this.initialized;
    return this.engine.forceLearn();
  }

  /**
   * Parses JSON stats string from engine into object.
   */
  public async getStats(): Promise<Record<string, unknown>> {
    await this.initialized;
    const raw = this.engine.getStats();
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { rawStats: raw };
    }
  }

  /**
   * Ensures all embeddings entering SONA match configured dimensionality.
   */
  private assertEmbedding(embedding: number[]): void {
    if (embedding.length !== this.embeddingDim) {
      throw new Error(
        `Embedding length mismatch: expected ${this.embeddingDim}, got ${embedding.length}.`,
      );
    }
  }

  /**
   * Builds uniform attention vector for synthetic trajectory step recording.
   */
  private buildUniformAttention(size: number): number[] {
    const value = 1 / size;
    return Array.from({ length: size }, () => value);
  }

  /**
   * Maps SONA pattern structure to core domain structure.
   */
  private toLearnedPattern(pattern: JsLearnedPattern): LearnedPattern {
    return {
      id: pattern.id,
      avgQuality: pattern.avgQuality,
      clusterSize: pattern.clusterSize,
      patternType: pattern.patternType,
    };
  }

  /**
   * Replays persisted learning events to rebuild state after process restart.
   */
  private async initializeFromDisk(): Promise<void> {
    await fs.mkdir(dirname(this.eventsFilePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.eventsFilePath, 'utf-8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const schema = persistedLearningEventSchema(this.embeddingDim);

      for (const line of lines) {
        let event: PersistedLearningEvent;
        try {
          const parsed = JSON.parse(line) as unknown;
          event = schema.parse(parsed);
        } catch {
          // Old/corrupted records are skipped to keep startup resilient.
          continue;
        }

        const trajectoryId = this.engine.beginTrajectory(event.embedding);
        if (event.route) {
          this.engine.setTrajectoryRoute(trajectoryId, event.route);
        }

        this.engine.addTrajectoryContext(trajectoryId, event.queryText.slice(0, 256));
        this.engine.addTrajectoryStep(
          trajectoryId,
          event.embedding.map((value) => Math.tanh(value)),
          this.buildUniformAttention(64),
          event.qualityScore,
        );
        this.engine.endTrajectory(trajectoryId, event.qualityScore);
      }
    } catch (error) {
      const isMissingFile =
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (isMissingFile) {
        await fs.writeFile(this.eventsFilePath, '', 'utf-8');
        return;
      }
      throw error;
    }
  }

  /**
   * Appends one completed interaction event to disk-backed replay log.
   */
  private async appendEvent(event: PersistedLearningEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    await fs.appendFile(this.eventsFilePath, line, 'utf-8');
  }
}
