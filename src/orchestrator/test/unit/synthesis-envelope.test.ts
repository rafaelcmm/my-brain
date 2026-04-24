import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { wrapWithSynthesis } from "../../src/http/handlers/_envelope.js";
import { defaultRegistry, renderMetrics } from "../../src/observability/metrics.js";

afterEach(() => {
  defaultRegistry.reset();
});

test("wrapWithSynthesis records ok metrics and returns envelope", async () => {
  defaultRegistry.reset();

  const ctx = {
    config: {
      llmModel: "qwen3.5:0.8b",
      synthTimeoutMs: 15_000,
    },
    synthesis: {
      synthesize: async () => ({
        summary: "digest summary",
        model: "qwen3.5:0.8b",
        latencyMs: 42,
      }),
    },
  } as const;

  const result = await wrapWithSynthesis(
    ctx as never,
    "mb_digest",
    null,
    { rows: [] },
  );

  assert.equal(result.success, true);
  assert.equal(result.summary, "digest summary");
  assert.equal(result.synthesis.status, "ok");

  const metrics = renderMetrics();
  assert.match(metrics, /mb_synthesis_total\{status="ok",tool="mb_digest"\} 1/);
  assert.match(metrics, /mb_synthesis_latency_ms_count 1/);
});

test("wrapWithSynthesis records fallback metrics and preserves data", async () => {
  defaultRegistry.reset();

  const ctx = {
    config: {
      llmModel: "qwen3.5:0.8b",
      synthTimeoutMs: 15_000,
    },
    synthesis: {
      synthesize: async () => {
        throw new Error("timeout after 15000ms");
      },
    },
  } as const;

  const payload = { query: "q", results: [] };
  const result = await wrapWithSynthesis(ctx as never, "mb_recall", "q", payload);

  assert.equal(result.success, true);
  assert.equal(result.summary, "");
  assert.equal(result.data, payload);
  assert.equal(result.synthesis.status, "fallback");
  assert.match(result.synthesis.error ?? "", /timeout/);

  const metrics = renderMetrics();
  assert.match(
    metrics,
    /mb_synthesis_total\{status="fallback",tool="mb_recall"\} 1/,
  );
  assert.match(metrics, /mb_synthesis_latency_ms_count 1/);
});
