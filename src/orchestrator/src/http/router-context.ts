/**
 * Shared context types for the HTTP router and its per-route handlers.
 *
 * Extracted from router.ts into a dedicated module so that handler files
 * can import RouterContext and friends without creating a circular dependency
 * back to router.ts (which imports the handler files).
 */

import { type loadConfig } from "../config/load-config.js";
import type { RuntimeState } from "../bootstrap/runtime.js";
import type { SynthesisPort } from "../domain/synthesis.js";

/** Inferred config shape from loadConfig return value. */
type OrchestratorConfig = ReturnType<typeof loadConfig>;

/**
 * Capabilities payload derived from runtime state.
 * Used by health, ready, and capabilities routes.
 */
export interface Capabilities {
  engine: boolean;
  vectorDb: boolean;
  sona: boolean;
  attention: boolean;
  embeddingDim: number;
}

/**
 * Derives current capability flags from the runtime state.
 *
 * @param state - Current runtime state.
 * @returns Capability flags for health and capabilities routes.
 */
export function getCapabilities(state: RuntimeState): Capabilities {
  const vectorReady = state.db.connected && state.db.adrSchemasReady;
  const engineReady = state.engine.loaded;
  return {
    engine: engineReady,
    vectorDb: vectorReady,
    sona: state.engine.sona,
    attention: state.engine.attention,
    embeddingDim: state.embedding.dim,
  };
}

/**
 * Returns the minimum recall similarity threshold for the current runtime quality mode.
 *
 * Higher threshold (0.85) is used in degraded mode when the engine is not fully
 * loaded, reducing false-positive recall at the cost of lower recall rate.
 *
 * @param state - Current runtime state.
 * @returns Minimum score threshold for recall filtering.
 */
export function getDefaultRecallThreshold(state: RuntimeState): number {
  return state.engine.loaded ? 0.6 : 0.85;
}

/**
 * Dependencies injected into handleRequest and per-route handlers by the bootstrap.
 *
 * Using a context object instead of closures keeps all route handlers testable:
 * tests can provide stub implementations without patching module globals.
 */
export interface RouterContext {
  /** Immutable orchestrator config loaded at startup. */
  config: OrchestratorConfig;
  /** Mutable runtime state shared across routes. */
  state: RuntimeState;
  /** Maximum request body bytes enforced by the body parser. */
  maxRequestBodyBytes: number;
  /** Bound embed function that uses the current runtime embedding state. */
  embedText: (content: string) => Promise<number[]>;
  /** Bound cached-embed function for recall scoring. */
  getCachedEmbedding: (content: string) => Promise<number[]>;
  /** Bound synthesis port used by handlers for LLM summary generation. */
  synthesis: SynthesisPort;
}
