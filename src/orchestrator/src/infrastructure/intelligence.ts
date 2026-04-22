/**
 * Intelligence engine and LLM runtime initialization via ruvector and ruvllm.
 *
 * Both libraries are native modules loaded through `createRequire` rather than
 * standard ESM `import`. The ambient type declarations in `types/ambient.d.ts`
 * provide type-safe interfaces so callers remain fully typed.
 *
 * Degraded-mode behavior is intentional: the orchestrator starts and answers
 * health checks even when the intelligence engine or LLM is unavailable.
 * Capabilities flags reflect the partial state so callers can adapt.
 */

import { createRequire } from "node:module";
import type { IntelligenceEngine } from "../types/ambient.js";

// Loaded via CommonJS require because the native bindings use module.exports.
const require = createRequire(import.meta.url);

/**
 * Subset of orchestrator config consumed by intelligence and LLM init.
 */
export interface IntelligenceConfig {
  /** Embedding vector dimension forwarded to engine memory allocation. */
  readonly embeddingDim: number;
  /** Whether SONA adaptive learning is enabled for this deployment. */
  readonly sonaEnabled: boolean;
  /** Ollama model identifier forwarded to RuvLLM instantiation. */
  readonly llmModel: string;
}

/**
 * Mutable engine state updated in place by initializeIntelligenceEngine.
 */
export interface EngineState {
  /** Whether the engine is loaded and ready to accept embed/remember calls. */
  loaded: boolean;
  /** Whether SONA adaptive learning is active in the loaded engine. */
  sona: boolean;
  /** Whether self-attention embeddings are active in the loaded engine. */
  attention: boolean;
  /** Actual embedding dimension reported by the engine after init. */
  embeddingDim: number;
  /** Error message recorded when initialization fails, or null. */
  error: string | null;
}

/**
 * Mutable LLM state updated in place by initializeLlmRuntime.
 */
export interface LlmState {
  /** Whether the RuvLLM instance was created successfully. */
  loaded: boolean;
  /** Error message recorded when initialization fails, or null. */
  error: string | null;
}

/**
 * Initializes the ruvector intelligence engine with embedding and learning features.
 *
 * The engine is created synchronously via the native module. Failure is caught
 * and recorded in `state.error` so the service can start in degraded mode.
 * Engine stat fields (sona, attention, embeddingDim) are read from the engine
 * after the fact rather than assumed from config to reflect the actual runtime.
 *
 * @param config - Intelligence config slice.
 * @param state - Mutable engine state record updated in place.
 * @param pushDegradedReason - Callback to record a degradation reason string.
 * @returns The initialized engine instance, or null on failure.
 */
export function initializeIntelligenceEngine(
  config: IntelligenceConfig,
  state: EngineState,
  pushDegradedReason: (reason: string) => void,
): IntelligenceEngine | null {
  try {
    const { createIntelligenceEngine } = require("ruvector") as {
      createIntelligenceEngine: (opts: {
        embeddingDim: number;
        maxMemories: number;
        enableSona: boolean;
        enableAttention: boolean;
      }) => IntelligenceEngine;
    };

    const engine = createIntelligenceEngine({
      embeddingDim: config.embeddingDim,
      maxMemories: 100000,
      enableSona: config.sonaEnabled,
      enableAttention: true,
    });

    state.loaded = true;

    const stats = engine.getStats() as
      | Record<string, unknown>
      | null
      | undefined;
    state.sona = Boolean(stats?.["sonaEnabled"]);
    state.attention = Boolean(stats?.["attentionEnabled"]);
    state.embeddingDim = Number(
      stats?.["memoryDimensions"] ?? config.embeddingDim,
    );

    return engine;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    pushDegradedReason("intelligence engine failed");
    return null;
  }
}

/**
 * Initializes the RuvLLM runtime so capabilities correctly report LLM state.
 *
 * Failure is caught and recorded in `state.error`. The orchestrator continues
 * to serve requests without LLM support when this init fails.
 *
 * @param config - Intelligence config slice.
 * @param state - Mutable LLM state record updated in place.
 * @param pushDegradedReason - Callback to record a degradation reason string.
 * @returns The initialized RuvLLM instance, or null on failure.
 */
export function initializeLlmRuntime(
  config: IntelligenceConfig,
  state: LlmState,
  pushDegradedReason: (reason: string) => void,
): unknown {
  try {
    const { RuvLLM } = require("@ruvector/ruvllm") as {
      RuvLLM: new (opts: {
        modelPath: string;
        sonaEnabled: boolean;
        flashAttention: boolean;
        maxTokens: number;
        temperature: number;
        topP: number;
        embeddingDim: number;
      }) => unknown;
    };

    const llm = new RuvLLM({
      modelPath: config.llmModel,
      sonaEnabled: config.sonaEnabled,
      flashAttention: true,
      maxTokens: 512,
      temperature: 0.7,
      topP: 0.9,
      embeddingDim: config.embeddingDim,
    });

    state.loaded = true;
    return llm;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    pushDegradedReason("llm runtime failed");
    return null;
  }
}
