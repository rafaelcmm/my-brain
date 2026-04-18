import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VectorDb } from '@ruvector/core';
import { SonaEngine, type JsLearnedPattern } from '@ruvector/sona';
import type { AdaptiveBrainPort } from '../../../core/ports/adaptive-brain-port.js';
import type {
  InteractionRecord,
  LearnedPattern,
  QueryEvidence,
} from '../../../core/domain/interaction.js';

export interface SonaRuntimeConfig {
  readonly microLoraRank: number;
  readonly baseLoraRank: number;
  readonly microLoraLr: number;
  readonly qualityThreshold: number;
  readonly patternClusters: number;
  readonly ewcLambda: number;
}

interface InteractionBuffer {
  readonly queryText: string;
  readonly embedding: number[];
  readonly trajectoryId: number;
  readonly adaptedEmbedding: number[];
}

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
  private readonly interactionQuality = new Map<string, number>();
  private readonly interactionStore = new Map<string, InteractionRecord>();
  private readonly engine: SonaEngine;
  private readonly vectorDb: VectorDb;
  private readonly interactionStorePath: string;
  private storeLoadPromise: Promise<void> | undefined;
  private storeWriteQueue = Promise.resolve();

  /**
   * @param embeddingDim Embedding dimensionality expected by engine.
   * @param ruvectorDbPath Persistent ruvector DB file path.
   */
  public constructor(
    private readonly embeddingDim: number,
    private readonly ruvectorDbPath = '/data/ruvector.db',
    private readonly sonaConfig: SonaRuntimeConfig = {
      microLoraRank: 2,
      baseLoraRank: 16,
      microLoraLr: 0.002,
      qualityThreshold: 0.3,
      patternClusters: 100,
      ewcLambda: 2000,
    },
  ) {
    this.engine = SonaEngine.withConfig({
      hiddenDim: embeddingDim,
      embeddingDim,
      microLoraRank: this.sonaConfig.microLoraRank,
      baseLoraRank: this.sonaConfig.baseLoraRank,
      microLoraLr: this.sonaConfig.microLoraLr,
      qualityThreshold: this.sonaConfig.qualityThreshold,
      patternClusters: this.sonaConfig.patternClusters,
      ewcLambda: this.sonaConfig.ewcLambda,
    });
    this.vectorDb = new VectorDb({
      dimensions: embeddingDim,
      storagePath: ruvectorDbPath,
    });
    this.interactionStorePath = `${ruvectorDbPath}.interactions.json`;
  }

  /**
   * Begins SONA trajectory and returns externally-visible interaction ID.
   */
  public async beginInteraction(queryText: string, embedding: number[]): Promise<string> {
    this.assertEmbedding(embedding);

    const trajectoryId = this.engine.beginTrajectory(embedding);
    const interactionId = randomUUID();

    this.engine.addTrajectoryContext(trajectoryId, queryText.slice(0, 256));
    this.interactionToTrajectory.set(interactionId, trajectoryId);
    this.interactionBuffer.set(interactionId, {
      queryText,
      embedding,
      trajectoryId,
      adaptedEmbedding: embedding,
    });
    await this.upsertInteractionRecord({
      interactionId,
      queryText,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      status: 'pending',
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
    await this.ensureInteractionStoreLoaded();
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
    this.interactionQuality.set(interactionId, qualityScore);

    await this.vectorDb.insert({
      id: interactionId,
      // Persist stable base semantic embedding for retrieval.
      vector: Float32Array.from(buffer.embedding),
    });
    const completedAtIso = new Date().toISOString();
    const existingRecord = this.interactionStore.get(interactionId);
    await this.upsertInteractionRecord({
      interactionId,
      queryText: existingRecord?.queryText ?? buffer.queryText,
      createdAtIso: existingRecord?.createdAtIso ?? completedAtIso,
      updatedAtIso: completedAtIso,
      status: 'completed',
      qualityScore,
      route,
      completedAtIso,
    });

    this.interactionToTrajectory.delete(interactionId);
    this.interactionBuffer.delete(interactionId);
  }

  /**
   * Applies micro-LoRA online adaptation and records lightweight trace step.
   */
  public async applyInstantLearning(interactionId: string, embedding: number[]): Promise<number[]> {
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

    const existing = this.interactionBuffer.get(interactionId);
    if (existing) {
      this.interactionBuffer.set(interactionId, {
        ...existing,
        adaptedEmbedding: adapted,
      });
    }

    return adapted;
  }

  /**
   * Returns nearest learned pattern summaries.
   */
  public async findPatterns(embedding: number[], limit: number): Promise<LearnedPattern[]> {
    this.assertEmbedding(embedding);

    return this.engine
      .findPatterns(embedding, limit)
      .map((pattern) => this.toLearnedPattern(pattern));
  }

  /**
   * Returns concrete interaction memories from vector retrieval with readable metadata.
   */
  public async findMatchedEvidence(
    embedding: number[],
    limit: number,
    excludeInteractionIds: readonly string[] = [],
  ): Promise<QueryEvidence[]> {
    this.assertEmbedding(embedding);
    await this.ensureInteractionStoreLoaded();

    const excludedIds = new Set(excludeInteractionIds);
    const matches = await this.vectorDb.search({
      vector: Float32Array.from(embedding),
      k: limit + excludedIds.size,
    });

    return matches
      .filter((match) => !excludedIds.has(match.id))
      .map((match, index) => this.toQueryEvidence(match.id, match.score, index + 1))
      .filter((evidence): evidence is QueryEvidence => evidence !== undefined)
      .slice(0, limit);
  }

  /**
   * Loads one persisted interaction for follow-up inspection.
   */
  public async getInteractionRecord(interactionId: string): Promise<InteractionRecord> {
    await this.ensureInteractionStoreLoaded();
    const record = this.interactionStore.get(interactionId);
    if (!record) {
      throw new Error('Interaction not found.');
    }

    return record;
  }

  /**
   * Returns active adapted embedding when interaction is still in the live buffer.
   */
  public async getBufferedAdaptedEmbedding(interactionId: string): Promise<number[] | undefined> {
    return this.interactionBuffer.get(interactionId)?.adaptedEmbedding;
  }

  /**
   * Forces background learning cycle.
   */
  public async forceLearn(): Promise<string> {
    return this.engine.forceLearn();
  }

  /**
   * Parses JSON stats string from engine into object.
   */
  public async getStats(): Promise<Record<string, unknown>> {
    const raw = this.engine.getStats();
    const vectorCount = await this.vectorDb.len();
    try {
      return {
        ...(JSON.parse(raw) as Record<string, unknown>),
        ruvector_entries: vectorCount,
      };
    } catch {
      return { rawStats: raw, ruvector_entries: vectorCount };
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

    const hasNonFiniteValue = embedding.some((value) => !Number.isFinite(value));
    if (hasNonFiniteValue) {
      throw new Error('Embedding contains non-finite values.');
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
   * Converts vector distance into bounded similarity-like score in range (0, 1].
   */
  private normalizeScore(distance: number): number {
    const safeDistance = Number.isFinite(distance)
      ? Math.max(0, distance)
      : Number.POSITIVE_INFINITY;
    return Number.isFinite(safeDistance) ? 1 / (1 + safeDistance) : 0;
  }

  /**
   * Loads persisted interaction metadata lazily so adapter construction stays synchronous.
   */
  private async ensureInteractionStoreLoaded(): Promise<void> {
    this.storeLoadPromise ??= (async () => {
      try {
        const raw = await readFile(this.interactionStorePath, 'utf8');
        const parsed = JSON.parse(raw) as InteractionRecord[];
        for (const record of parsed) {
          this.interactionStore.set(record.interactionId, record);
          if (record.qualityScore !== undefined) {
            this.interactionQuality.set(record.interactionId, record.qualityScore);
          }
        }
      } catch (error) {
        const isMissingFile = error instanceof Error && 'code' in error && error.code === 'ENOENT';
        if (!isMissingFile) {
          throw error;
        }
      }
    })();

    await this.storeLoadPromise;
  }

  /**
   * Upserts one interaction record and serializes the sidecar store durably.
   */
  private async upsertInteractionRecord(record: InteractionRecord): Promise<void> {
    await this.ensureInteractionStoreLoaded();
    this.interactionStore.set(record.interactionId, record);
    if (record.qualityScore !== undefined) {
      this.interactionQuality.set(record.interactionId, record.qualityScore);
    }

    this.storeWriteQueue = this.storeWriteQueue.then(async () => {
      await mkdir(dirname(this.interactionStorePath), { recursive: true });
      await writeFile(
        this.interactionStorePath,
        JSON.stringify([...this.interactionStore.values()], null, 2),
        'utf8',
      );
    });

    await this.storeWriteQueue;
  }

  /**
   * Converts one vector hit into explainable evidence when metadata is available.
   */
  private toQueryEvidence(
    interactionId: string,
    rawScore: number,
    retrievalRank: number,
  ): QueryEvidence | undefined {
    const record = this.interactionStore.get(interactionId);
    if (!record) {
      return undefined;
    }

    const score = this.normalizeScore(rawScore);
    const similarityPercent = Math.round(score * 100);
    const qualitySegment =
      record.qualityScore === undefined
        ? 'No feedback recorded yet.'
        : `Feedback quality ${record.qualityScore.toFixed(2)}.`;
    const routeSegment = record.route ? ` Route ${record.route}.` : '';

    return {
      interactionId,
      text: record.queryText,
      score,
      rawScore,
      scoreType: 'vectorSimilarity',
      whyMatched:
        `Rank #${retrievalRank}, raw distance ${rawScore.toFixed(6)}, normalized similarity ${similarityPercent}%.${routeSegment} ${qualitySegment}`.trim(),
      retrievalRank,
      route: record.route,
      qualityScore: record.qualityScore,
      createdAtIso: record.createdAtIso,
      status: record.status,
    };
  }
}
