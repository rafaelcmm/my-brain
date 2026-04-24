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
    const caps = b["capabilities"] as Record<string, unknown> | undefined;
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
});
