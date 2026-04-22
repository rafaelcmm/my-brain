/**
 * Unit tests for intelligence and LLM runtime initialization.
 *
 * These tests verify that the orchestrator can resolve native dependencies and
 * records deterministic state transitions for startup health gates.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initializeIntelligenceEngine,
  initializeLlmRuntime,
  type EngineState,
  type LlmState,
} from "../../src/infrastructure/intelligence.js";

/**
 * Builds a fresh mutable engine state object for each test.
 *
 * @returns EngineState initialized to the pre-bootstrap defaults.
 */
function makeEngineState(): EngineState {
  return {
    loaded: false,
    sona: false,
    attention: false,
    embeddingDim: 1024,
    error: null,
  };
}

/**
 * Builds a fresh mutable LLM state object for each test.
 *
 * @returns LlmState initialized to the pre-bootstrap defaults.
 */
function makeLlmState(): LlmState {
  return {
    loaded: false,
    error: null,
  };
}

describe("initializeIntelligenceEngine", () => {
  it("loads engine factory and marks state as loaded", () => {
    const degradedReasons: string[] = [];
    const state = makeEngineState();

    const engine = initializeIntelligenceEngine(
      {
        embeddingDim: 1024,
        sonaEnabled: true,
        llmModel: "qwen3.5:0.8b",
      },
      state,
      (reason) => degradedReasons.push(reason),
    );

    assert.ok(engine, "engine must initialize with installed ruvector package");
    assert.equal(state.loaded, true, "state.loaded must be true on success");
    assert.equal(state.error, null, "state.error must stay null on success");
    assert.equal(
      degradedReasons.length,
      0,
      "no degraded reason should be pushed on successful init",
    );
  });
});

describe("initializeLlmRuntime", () => {
  it("creates runtime and marks llm state as loaded", () => {
    const degradedReasons: string[] = [];
    const state = makeLlmState();

    const llm = initializeLlmRuntime(
      {
        embeddingDim: 1024,
        sonaEnabled: true,
        llmModel: "qwen3.5:0.8b",
      },
      state,
      (reason) => degradedReasons.push(reason),
    );

    assert.ok(llm, "llm runtime must initialize with installed ruvllm package");
    assert.equal(state.loaded, true, "state.loaded must be true on success");
    assert.equal(state.error, null, "state.error must stay null on success");
    assert.equal(
      degradedReasons.length,
      0,
      "no degraded reason should be pushed on successful init",
    );
  });
});
