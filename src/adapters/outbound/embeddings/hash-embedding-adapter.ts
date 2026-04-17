import type { EmbeddingsPort } from '../../../core/ports/embeddings-port.js';

/**
 * HashEmbeddingAdapter provides deterministic lightweight embeddings for tests.
 *
 * Adapter is not semantic-grade and should be used only for local fast tests or
 * constrained environments where model download is undesirable.
 */
export class HashEmbeddingAdapter implements EmbeddingsPort {
  /**
   * @param dimension Fixed vector size to produce.
   */
  public constructor(private readonly dimension: number) {}

  /**
   * Creates deterministic normalized vector based on character hashing.
   */
  public async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Embedding input text must not be empty.');
    }

    const vector = new Array<number>(this.dimension).fill(0);
    for (let index = 0; index < trimmed.length; index += 1) {
      const code = trimmed.charCodeAt(index);
      const slot = (code + index * 31) % this.dimension;
      vector[slot] += 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm > 0) {
      return vector.map((value) => value / norm);
    }

    return vector;
  }

  /**
   * Returns fixed embedding dimension.
   */
  public getDimension(): number {
    return this.dimension;
  }
}
