import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import type { EmbeddingsPort } from '../../../core/ports/embeddings-port.js';

/**
 * MiniLmEmbeddingAdapter generates sentence embeddings using local transformers runtime.
 *
 * Adapter lazily initializes model pipeline to avoid startup penalty when process
 * bootstraps but receives no requests.
 */
export class MiniLmEmbeddingAdapter implements EmbeddingsPort {
  private extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

  /**
   * @param modelId HF model identifier (all-MiniLM-L6-v2 by default).
   * @param dimension Expected output vector size.
   * @param cacheDir Optional cache directory for offline-friendly deployments.
   */
  public constructor(
    private readonly modelId: string,
    private readonly dimension: number,
    private readonly cacheDir?: string,
    private readonly quantized = false,
  ) {}

  /**
   * Embeds input text with mean pooling + normalization.
   */
  public async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Embedding input text must not be empty.');
    }

    const extractor = await this.getExtractor();
    const output = await extractor(trimmed, { pooling: 'mean', normalize: true });

    const vector = Array.from(output.data as Float32Array | Float64Array | number[]);
    if (vector.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch. Expected ${this.dimension}, received ${vector.length}.`,
      );
    }

    return vector;
  }

  /**
   * Returns fixed embedding dimension for this adapter instance.
   */
  public getDimension(): number {
    return this.dimension;
  }

  /**
   * Lazily creates feature-extraction pipeline exactly once.
   */
  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      this.extractorPromise = pipeline('feature-extraction', this.modelId, {
        quantized: this.quantized,
        cache_dir: this.cacheDir,
      });
    }

    return this.extractorPromise;
  }
}
