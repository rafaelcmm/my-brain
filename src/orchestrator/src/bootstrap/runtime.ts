/**
 * Runtime state shape for the orchestrator process.
 *
 * All mutable runtime fields are centralized here so modules that initialize
 * subsystems can accept typed state slices rather than closing over globals.
 * The full RuntimeState object is created once in bootstrap/main.ts and passed
 * to request handlers and subsystem initializers by reference.
 */

import type { Pool } from "pg";
import type { IntelligenceEngine } from "../types/ambient.js";
import type { DbState } from "../infrastructure/postgres.js";
import type { EngineState, LlmState } from "../infrastructure/intelligence.js";
import type { EmbeddingState } from "../infrastructure/embedding.js";

/**
 * SONA adaptive learning telemetry counters updated during session open/close.
 */
export interface LearningState {
  /** Total session_open calls since process start. */
  sessionsOpened: number;
  /** Total session_close calls since process start. */
  sessionsClosed: number;
  /** Sessions closed with success=true. */
  successfulSessions: number;
  /** Sessions closed with success=false. */
  failedSessions: number;
  /** Cumulative quality scores for average computation. */
  totalQuality: number;
  /** Most recently observed route label; used in capabilities readout. */
  currentRoute: string;
  /** Rolling confidence score updated by session outcome; range [0.05, 0.99]. */
  routeConfidence: number;
}

/**
 * Complete mutable runtime state for the orchestrator process.
 *
 * Subsystem initializers accept typed slices (DbState, EngineState, etc.) by
 * reference and mutate them in place. The top-level RuntimeState acts as the
 * composition root so references remain stable across the lifetime of the
 * process.
 */
export interface RuntimeState {
  /** ISO timestamp set immediately before the embedding provider warmup. */
  initializedAt: string | null;
  /** Postgres connectivity and schema readiness state. */
  db: DbState;
  /** RuvLLM instance load state. */
  llm: LlmState;
  /** Embedding provider warmup and vector-dimension state. */
  embedding: EmbeddingState;
  /** Intelligence engine load, SONA, attention, and dimension state. */
  engine: EngineState;
  /** Accumulated degradation reasons emitted at /health. */
  degradedReasons: string[];
  /** Active Postgres connection pool; null when DB initialization failed. */
  pool: Pool | null;
  /** Loaded intelligence engine instance; null when initialization failed. */
  intelligenceEngine: IntelligenceEngine | null;
  /** Loaded RuvLLM instance; null when initialization failed. */
  llmEngine: unknown;
  /** SONA learning telemetry; updated on session open/close. */
  learning: LearningState;
}

/**
 * Creates the initial mutable runtime state for a fresh process.
 *
 * All subsystem flags start as false/null so the health endpoint correctly
 * reports degraded until each initializer runs successfully.
 *
 * @param embeddingDim - Compile-time default embedding dimension from config;
 *   updated in place by the embedding provider after warmup.
 * @returns Fresh runtime state with all subsystems marked as not-yet-initialized.
 */
export function createInitialRuntimeState(embeddingDim: number): RuntimeState {
  return {
    initializedAt: null,
    db: {
      connected: false,
      extensionVersion: null,
      adrSchemasReady: false,
      error: null,
    },
    llm: {
      loaded: false,
      error: null,
    },
    embedding: {
      ready: false,
      dim: embeddingDim,
      provider: "fallback",
      error: null,
    },
    engine: {
      loaded: false,
      sona: false,
      attention: false,
      embeddingDim,
      error: null,
    },
    degradedReasons: [],
    pool: null,
    intelligenceEngine: null,
    llmEngine: null,
    learning: {
      sessionsOpened: 0,
      sessionsClosed: 0,
      successfulSessions: 0,
      failedSessions: 0,
      totalQuality: 0,
      currentRoute: "default",
      routeConfidence: 0.5,
    },
  };
}
