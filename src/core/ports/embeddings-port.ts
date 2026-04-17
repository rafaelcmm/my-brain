/**
 * EmbeddingsPort abstracts sentence embedding generation away from use-cases.
 *
 * Application depends on this contract so runtime can switch from local
 * all-MiniLM to any future embedding backend without business logic changes.
 */
export interface EmbeddingsPort {
  /**
   * Creates a dense vector embedding for one text input.
   *
   * @param text Natural language text to embed.
   * @returns Numeric vector with stable dimensionality for configured model.
   * @throws Error when model load/inference fails.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Returns embedding dimensionality used by the implementation.
   */
  getDimension(): number;
}
