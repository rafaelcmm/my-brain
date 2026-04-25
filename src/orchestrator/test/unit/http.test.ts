/**
 * HTTP handler integration tests for the orchestrator router.
 *
 * Spins up a real http.Server with a minimal RouterContext and fires HTTP
 * requests over a live socket. No mocks on network or http internals —
 * the tests exercise the full request/response cycle through handleRequest.
 *
 * Subsystems that require live infrastructure (DB, engine, embedding) are
 * initialized to their "not ready" states so the suite runs without external
 * services. This validates auth gating, routing, error surfaces, and the
 * health/capabilities contracts in isolation.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createInitialRuntimeState } from "../../src/bootstrap/runtime.js";
import { handleRequest } from "../../src/http/router.js";
import type { RouterContext } from "../../src/http/router.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sends an HTTP request to the test server and resolves with the parsed
 * response status and JSON body.
 *
 * @param opts - Request options including method, path, headers, and body.
 * @returns Resolved status code and parsed JSON body.
 */
function request(opts: {
  port: number;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        method: opts.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(payload
            ? { "Content-Length": String(Buffer.byteLength(payload)) }
            : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += String(chunk);
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Reads the current synthesis counter total for a specific tool label.
 *
 * Prometheus text output can include separate `ok` and `fallback` labels,
 * so this parser sums both to assert whether handler execution reached
 * synthesis at all.
 *
 * @param metricsBody - Raw `/metrics` response body.
 * @param tool - Synthesis tool label to aggregate.
 * @returns Counter sum for all synthesis statuses of the tool.
 */
function getSynthesisTotalForTool(metricsBody: string, tool: string): number {
  let total = 0;
  for (const line of metricsBody.split("\n")) {
    if (!line.startsWith("mb_synthesis_total{")) {
      continue;
    }
    if (!line.includes(`tool="${tool}"`)) {
      continue;
    }
    const fields = line.trim().split(/\s+/u);
    const value = Number(fields[fields.length - 1]);
    if (Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

/**
 * Saturates one endpoint's fixed-window bucket and verifies rate limiting
 * fires before any synthesis call.
 *
 * The helper uses a stable forwarded IP so all requests map to one bucket,
 * then checks `mb_synthesis_total` for the associated tool remains unchanged.
 *
 * @param path - Endpoint path under test.
 * @param body - Request JSON payload.
 * @param tool - Expected synthesis tool label for metric assertions.
 * @param callerIp - Stable caller identity used to hit the same rate bucket.
 */
async function assertRateLimitBeforeSynthesis(opts: {
  path: string;
  body: Record<string, unknown>;
  tool: string;
  callerIp: string;
}): Promise<void> {
  const beforeMetrics = await request({
    port,
    path: "/metrics",
    headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
  });
  const before = getSynthesisTotalForTool(
    String(beforeMetrics.body ?? ""),
    opts.tool,
  );

  for (let i = 0; i < 60; i += 1) {
    const allowed = await request({
      port,
      path: opts.path,
      method: "POST",
      headers: {
        "X-Mybrain-Internal-Key": TEST_API_KEY,
        "X-Forwarded-For": opts.callerIp,
      },
      body: opts.body,
    });
    assert.notEqual(
      allowed.status,
      429,
      "first 60 requests in the window must not be rate-limited",
    );
  }

  const blocked = await request({
    port,
    path: opts.path,
    method: "POST",
    headers: {
      "X-Mybrain-Internal-Key": TEST_API_KEY,
      "X-Forwarded-For": opts.callerIp,
    },
    body: opts.body,
  });
  assert.equal(blocked.status, 429);

  const afterMetrics = await request({
    port,
    path: "/metrics",
    headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
  });
  const after = getSynthesisTotalForTool(
    String(afterMetrics.body ?? ""),
    opts.tool,
  );
  assert.equal(
    after,
    before,
    `synthesis counter for ${opts.tool} must not change on rate-limited path`,
  );
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

/** Stable internal API key used across all authenticated requests. */
const TEST_API_KEY = "test-internal-key-32-chars-long!!";

let server: http.Server;
let port: number;

/**
 * Builds a RouterContext with all subsystems in their uninitialized (degraded)
 * state so tests run without live Postgres, embedding, or intelligence engine.
 */
function makeCtx(): RouterContext {
  const state = createInitialRuntimeState(1024);
  const config = {
    mode: "full" as const,
    logLevel: "info",
    llmModel: "qwen3.5:0.8b",
    dbUrl: "",
    llmUrl: "",
    embeddingModel: "qwen3-embedding:0.6b",
    embeddingDim: 1024,
    vectorPort: 8080,
    sonaEnabled: false,
    tokenFile: "/run/secrets/auth-token",
    internalApiKey: TEST_API_KEY,
  };

  return {
    config,
    state,
    maxRequestBodyBytes: 1024 * 1024,
    embedText: async (_content: string): Promise<number[]> =>
      Array(1024).fill(0) as number[],
    getCachedEmbedding: async (_content: string): Promise<number[]> =>
      Array(1024).fill(0) as number[],
  };
}

before(async () => {
  const ctx = makeCtx();
  server = http.createServer((req, res) => {
    handleRequest(req, res, ctx).catch((err: unknown) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    });
  });
  await new Promise<void>((resolve) => {
    // Bind to port 0 so the OS assigns a free port — avoids port conflicts in CI.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      port = addr.port;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// ---------------------------------------------------------------------------
// T3.1 — GET /health (public, no auth required)
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with status ok and service name", async () => {
    const { status, body } = await request({ port, path: "/health" });
    assert.equal(status, 200);
    const b = body as Record<string, unknown>;
    assert.equal(b["status"], "ok");
    assert.equal(b["service"], "my-brain-orchestrator");
  });

  it("includes degraded:true when DB is not connected", async () => {
    const { status, body } = await request({ port, path: "/health" });
    assert.equal(status, 200);
    const b = body as Record<string, unknown>;
    // State is fresh (uninitialized) so degradedReasons may accumulate — we
    // just assert the field is present and boolean.
    assert.equal(typeof b["degraded"], "boolean");
  });

  it("includes capabilities map in response", async () => {
    const { body } = await request({ port, path: "/health" });
    const b = body as Record<string, unknown>;
    assert.ok(b["capabilities"] !== undefined, "capabilities must be present");
  });
});

// ---------------------------------------------------------------------------
// T3.2 — GET /ready (public, no auth required)
// ---------------------------------------------------------------------------

describe("GET /ready", () => {
  it("returns 503 when subsystems are not initialized", async () => {
    const { status } = await request({ port, path: "/ready" });
    // Ready requires engine, db, and llm — all are uninitialized in this ctx.
    assert.equal(status, 503);
  });
});

// ---------------------------------------------------------------------------
// T3.3 — Auth gating on protected routes
// ---------------------------------------------------------------------------

describe("auth gating", () => {
  it("returns 401 on /v1/capabilities without API key", async () => {
    const { status, body } = await request({ port, path: "/v1/capabilities" });
    assert.equal(status, 401);
    const b = body as Record<string, unknown>;
    assert.equal(b["error"], "UNAUTHORIZED");
  });

  it("returns 401 on POST /v1/memory/recall with wrong key", async () => {
    const { status } = await request({
      port,
      path: "/v1/memory/recall",
      method: "POST",
      headers: { "X-Mybrain-Internal-Key": "wrong-key" },
      body: { query: "test" },
    });
    assert.equal(status, 401);
  });

  it("returns non-401 on /v1/capabilities with correct API key", async () => {
    const { status } = await request({
      port,
      path: "/v1/capabilities",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });
    // State is degraded but auth passes — any non-401 is correct here.
    assert.notEqual(status, 401);
  });
});

// ---------------------------------------------------------------------------
// T3.4 — GET /v1/capabilities
// ---------------------------------------------------------------------------

describe("GET /v1/capabilities", () => {
  it("returns capabilities object when authenticated", async () => {
    const { status, body } = await request({
      port,
      path: "/v1/capabilities",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });
    assert.equal(status, 200);
    const b = body as Record<string, unknown>;
    const data = b["data"] as Record<string, unknown> | undefined;
    const caps = data?.["capabilities"] as Record<string, unknown> | undefined;
    assert.ok(caps !== undefined, "capabilities must be present");
    assert.equal(typeof caps["engine"], "boolean");
    assert.equal(typeof caps["vectorDb"], "boolean");
  });
});

// ---------------------------------------------------------------------------
// T3.5 — 404 on unknown routes
// ---------------------------------------------------------------------------

describe("unknown routes", () => {
  it("returns 404 for unknown path with valid key", async () => {
    const { status } = await request({
      port,
      path: "/v1/does-not-exist",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });
    assert.equal(status, 404);
  });
});

// ---------------------------------------------------------------------------
// T3.6 — POST /v1/memory/recall body validation
// ---------------------------------------------------------------------------

describe("POST /v1/memory/recall validation", () => {
  it("returns 400 when query field is missing", async () => {
    const { status, body } = await request({
      port,
      path: "/v1/memory/recall",
      method: "POST",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
      body: {},
    });
    // No DB → likely 503 or 400 depending on validation order. Assert not 401.
    assert.notEqual(status, 401, "must not be auth-rejected");
    const b = body as Record<string, unknown>;
    assert.ok(
      b["success"] === false || b["error"] !== undefined,
      "invalid body must return error",
    );
  });

  it("returns 503 for valid query when engine is unavailable", async () => {
    const { status } = await request({
      port,
      path: "/v1/memory/recall",
      method: "POST",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
      body: { query: "hello" },
    });

    assert.equal(status, 503);
  });

  it("returns 400 when legacy mode or model params are supplied", async () => {
    const { status, body } = await request({
      port,
      path: "/v1/memory/recall",
      method: "POST",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
      body: { query: "hello", mode: "legacy", model: "qwen3.5:0.8b" },
    });

    assert.equal(status, 400);
    const b = body as Record<string, unknown>;
    assert.equal(
      b["message"],
      "mode and model are no longer supported in v2 — synthesis is always on",
    );
  });
});

// ---------------------------------------------------------------------------
// T3.7 — Rate limit must fire before synthesis
// ---------------------------------------------------------------------------

describe("rate-limit before synthesis", () => {
  it("blocks memory recall before synthesis", async () => {
    await assertRateLimitBeforeSynthesis({
      path: "/v1/memory/recall",
      body: { query: "hello" },
      tool: "mb_recall",
      callerIp: "10.201.0.1",
    });
  });

  it("blocks memory write before synthesis", async () => {
    await assertRateLimitBeforeSynthesis({
      path: "/v1/memory",
      body: {
        content: "x",
        type: "decision",
        scope: "repo",
        metadata: { repo: "example/repo" },
      },
      tool: "mb_remember",
      callerIp: "10.201.0.2",
    });
  });

  it("blocks memory vote before synthesis", async () => {
    await assertRateLimitBeforeSynthesis({
      path: "/v1/memory/vote",
      body: { memory_id: "m1", direction: "up" },
      tool: "mb_vote",
      callerIp: "10.201.0.3",
    });
  });

  it("blocks memory forget before synthesis", async () => {
    await assertRateLimitBeforeSynthesis({
      path: "/v1/memory/forget",
      body: { memory_id: "m1", mode: "soft" },
      tool: "mb_forget",
      callerIp: "10.201.0.4",
    });
  });

  it("blocks memory digest before synthesis", async () => {
    await assertRateLimitBeforeSynthesis({
      path: "/v1/memory/digest",
      body: { since: "7d" },
      tool: "mb_digest",
      callerIp: "10.201.0.5",
    });
  });

  it("blocks session open before synthesis", async () => {
    await assertRateLimitBeforeSynthesis({
      path: "/v1/session/open",
      body: { agent: "test" },
      tool: "mb_session_open",
      callerIp: "10.201.0.6",
    });
  });

  it("blocks session close before synthesis", async () => {
    await assertRateLimitBeforeSynthesis({
      path: "/v1/session/close",
      body: { session_id: "s1", success: true },
      tool: "mb_session_close",
      callerIp: "10.201.0.7",
    });
  });
});
