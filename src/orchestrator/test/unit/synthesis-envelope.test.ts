import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { wrapWithSynthesis } from "../../src/http/handlers/_envelope.js";
import { defaultRegistry, renderMetrics } from "../../src/observability/metrics.js";
import { createOllamaSynthesis } from "../../src/infrastructure/ollama-synthesis.js";

let server: Server | null = null;

afterEach(() => {
  defaultRegistry.reset();
});

afterEach(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  server = null;
});

async function startSlowGenerateServer(delayMs: number): Promise<string> {
  server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: "late reply" }));
    }, delayMs);
  });

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind slow synthesis server");
  }

  return `http://127.0.0.1:${address.port}`;
}

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

test("wrapWithSynthesis returns fallback within timeout window for slow synthesis", async () => {
  defaultRegistry.reset();

  const llmUrl = await startSlowGenerateServer(2_000);
  const synthesis = createOllamaSynthesis({
    llmUrl,
    model: "qwen3.5:0.8b",
    defaultTimeoutMs: 1_000,
  });

  const ctx = {
    config: {
      llmModel: "qwen3.5:0.8b",
      synthTimeoutMs: 1_000,
    },
    synthesis,
  } as const;

  const startedAt = Date.now();
  const result = await wrapWithSynthesis(
    ctx as never,
    "mb_digest",
    null,
    { rows: [] },
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.synthesis.status, "fallback");
  assert.ok(elapsedMs <= 1_200, `expected fallback <=1200ms, got ${elapsedMs}`);
});
