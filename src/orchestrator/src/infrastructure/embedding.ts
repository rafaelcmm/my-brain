/**
 * Embedding provider initialization and LRU-cached embeddings.
 *
 * Supports two providers in priority order:
 *  1. Ollama HTTP API (when `llmUrl` is configured and warmup succeeds)
 *  2. ruvector intelligence engine (synchronous fallback)
 *
 * The LRU cache uses Map insertion-order eviction: when the cache exceeds
 * `maxEmbeddingCacheSize`, the oldest key (first iterated by Map.keys()) is
 * evicted. Lookup moves a hit to the end (delete + re-insert) to maintain
 * recency order within the map.
 */

import { createHash } from "node:crypto";
import { asVector } from "../domain/fingerprint.js";
import type { IntelligenceEngine } from "../types/ambient.js";

/**
 * Orchestrator config fields consumed by embedding initialization.
 */
export interface EmbeddingConfig {
  /** Ollama base URL, e.g. "http://localhost:11434". Empty string = disabled. */
  readonly llmUrl: string;
  /** Ollama model identifier for embedding calls, e.g. "nomic-embed-text". */
  readonly embeddingModel: string;
}

/**
 * Mutable embedding state updated in place by initializeEmbeddingProvider.
 */
export interface EmbeddingState {
  /** True once warmup succeeds and the provider is accepting requests. */
  ready: boolean;
  /** Human-readable provider label recorded after successful warmup. */
  provider: string;
  /** Embedding dimension confirmed by the warmup vector's length. */
  dim: number;
  /** Error message when initialization fails, or null. */
  error: string | null;
}

/**
 * Probes the Ollama embedding API and updates embeddingState and engineState
 * with the confirmed vector dimension.
 *
 * Also propagates the confirmed dimension back to `engineEmbeddingDimRef` so
 * downstream callers (postgres schema, recall, scoring) use the real value
 * rather than the compile-time default.
 *
 * @param config - Embedding config slice.
 * @param embeddingState - Mutable embedding state updated in place.
 * @param engineEmbeddingDimRef - Object with a mutable `embeddingDim` property
 *   synced to the confirmed vector dimension after warmup.
 * @param pushDegradedReason - Callback to record a degradation reason string.
 */
export async function initializeEmbeddingProvider(
  config: EmbeddingConfig,
  embeddingState: EmbeddingState,
  engineEmbeddingDimRef: { embeddingDim: number },
  pushDegradedReason: (reason: string) => void,
): Promise<void> {
  if (!config.llmUrl) {
    embeddingState.error = "MYBRAIN_LLM_URL not configured";
    pushDegradedReason("embedding provider url missing");
    return;
  }

  try {
    const response = await fetch(`${config.llmUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.embeddingModel,
        prompt: "my-brain warmup",
      }),
    });

    if (!response.ok) {
      throw new Error(`embedding warmup failed: ${response.status}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const vector = asVector(body["embedding"]);
    if (!vector || vector.length === 0) {
      throw new Error("embedding response missing vector");
    }

    embeddingState.ready = true;
    embeddingState.provider = "ollama";
    embeddingState.dim = vector.length;
    engineEmbeddingDimRef.embeddingDim = vector.length;
  } catch (error) {
    embeddingState.error =
      error instanceof Error ? error.message : String(error);
    pushDegradedReason("embedding warmup failed");
  }
}

/**
 * Computes an embedding vector with Ollama as primary and the intelligence
 * engine as synchronous fallback.
 *
 * Throws when both providers are unavailable so callers can record a clean
 * error message rather than receiving a silently empty vector.
 *
 * @param content - Source text to embed.
 * @param embeddingState - Current embedding state for provider selection.
 * @param config - Embedding config slice.
 * @param intelligenceEngine - Loaded engine instance, or null when not ready.
 * @returns Embedding vector as a plain number array.
 */
export async function embedText(
  content: string,
  embeddingState: EmbeddingState,
  config: EmbeddingConfig,
  intelligenceEngine: IntelligenceEngine | null,
): Promise<number[]> {
  if (embeddingState.ready) {
    const response = await fetch(`${config.llmUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.embeddingModel, prompt: content }),
    });

    if (response.ok) {
      const body = (await response.json()) as Record<string, unknown>;
      const vector = asVector(body["embedding"]);
      if (vector && vector.length > 0) {
        return vector;
      }
    }
  }

  if (intelligenceEngine) {
    return intelligenceEngine.embed(content) as number[];
  }

  throw new Error("embedding engine unavailable");
}

/**
 * Retrieves an embedding from the LRU cache or computes it via embedText.
 *
 * The cache key is the SHA-1 hex digest of the normalized (trimmed, lowercased,
 * collapsed-whitespace) content string. Normalization intentionally discards
 * insignificant whitespace so near-identical inputs share cache entries.
 *
 * Eviction uses Map insertion-order: cache hits are promoted (delete + re-add)
 * so the oldest unused entry is always at the front of the map's iteration order.
 *
 * @param content - Memory content string to embed.
 * @param cache - Shared LRU Map (insertion-ordered) to read and update.
 * @param maxCacheSize - Max cache entries before evicting the oldest.
 * @param embed - Bound function that produces the embedding when cache misses.
 * @returns Cached or freshly computed embedding vector.
 */
export async function getCachedEmbedding(
  content: string,
  cache: Map<string, number[]>,
  maxCacheSize: number,
  embed: (content: string) => Promise<number[]>,
): Promise<number[]> {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  const cacheKey = createHash("sha1").update(normalized).digest("hex");

  if (cache.has(cacheKey)) {
    // Promote to most-recent by moving to end of insertion order.
    const cached = cache.get(cacheKey)!;
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const embedding = await embed(content);
  cache.set(cacheKey, embedding);

  // Evict oldest entry when the cache exceeds the configured size limit.
  if (cache.size > maxCacheSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }

  return embedding;
}
