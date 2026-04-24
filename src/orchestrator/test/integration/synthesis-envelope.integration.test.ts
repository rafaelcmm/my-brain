/**
 * Integration coverage for v2 synthesis envelope across mb_* endpoints.
 *
 * Uses real HTTP router + real Postgres (when TEST_DB_URL is set) and a fake
 * Ollama generate server to validate both synthesis success and fallback paths.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createInitialRuntimeState } from "../../src/bootstrap/runtime.js";
import { handleRequest } from "../../src/http/router.js";
import type { RouterContext } from "../../src/http/router.js";
import {
  createPool,
  initializeDatabase,
} from "../../src/infrastructure/postgres.js";
import { persistMemoryMetadata } from "../../src/infrastructure/postgres-memory.js";
import { createOllamaSynthesis } from "../../src/infrastructure/ollama-synthesis.js";
import type { MemoryEnvelope } from "../../src/domain/types.js";

const TEST_DB_URL = process.env["TEST_DB_URL"];
const TEST_API_KEY = "test-internal-key";

if (!TEST_DB_URL) {
  console.log(
    "[integration] Skipping synthesis-envelope suite — TEST_DB_URL not set.",
  );
  process.exit(0);
}

let pool: Pool;
let orchestratorServer: http.Server;
let orchestratorPort = 0;
let llmServer: http.Server;
let llmPort = 0;
let llmMode: "ok" | "fail" = "ok";
const insertedMemoryIds: string[] = [];

function makeMemoryEnvelope(content: string): MemoryEnvelope {
  return {
    content,
    type: "decision",
    scope: "repo",
    metadata: {
      repo: "github.com/test/repo",
      repo_name: "test/repo",
      project: "test-project",
      language: "typescript",
      frameworks: ["nextjs"],
      tags: ["memory", "integration"],
      embedding: Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0)),
    },
  };
}

function request(opts: {
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: orchestratorPort,
        path: opts.path,
        method: opts.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Mybrain-Internal-Key": TEST_API_KEY,
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
            reject(new Error(`expected JSON response for ${opts.path}`));
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

function assertEnvelope(
  payload: Record<string, unknown>,
  expectedStatus: "ok" | "fallback",
): void {
  assert.equal(payload["success"], true);
  assert.equal(typeof payload["summary"], "string");
  assert.equal(typeof payload["data"], "object");
  const synthesis = payload["synthesis"] as Record<string, unknown>;
  assert.equal(synthesis["status"], expectedStatus);
  assert.equal(typeof synthesis["model"], "string");
  assert.equal(typeof synthesis["latency_ms"], "number");
  if (expectedStatus === "ok") {
    assert.notEqual(payload["summary"], "");
  } else {
    assert.equal(payload["summary"], "");
    assert.equal(typeof synthesis["error"], "string");
  }
}

before(async () => {
  pool = createPool(TEST_DB_URL!);

  const dbState = {
    connected: false,
    extensionVersion: null,
    adrSchemasReady: false,
    error: null,
  };
  const initialized = await initializeDatabase(
    { dbUrl: TEST_DB_URL!, embeddingDim: 1024 },
    dbState,
    () => undefined,
  );
  assert.ok(initialized, "database must initialize for integration tests");
  pool = initialized;

  const seedId = `synth-env-seed-${Date.now()}`;
  insertedMemoryIds.push(seedId);
  await persistMemoryMetadata(
    pool,
    seedId,
    makeMemoryEnvelope("Seed memory used by vote/forget/recall integration tests"),
  );

  llmServer = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    if (llmMode === "fail") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forced failure" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ response: "synthesized summary" }));
  });

  await new Promise<void>((resolve) => {
    llmServer.listen(0, "127.0.0.1", () => {
      const address = llmServer.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to bind fake llm server");
      }
      llmPort = address.port;
      resolve();
    });
  });

  const state = createInitialRuntimeState(1024);
  state.pool = pool;
  state.db.connected = true;
  state.db.adrSchemasReady = true;

  // Minimal engine contract used by write/session handlers.
  state.intelligenceEngine = {
    remember: async () => ({ id: `remembered-${randomUUID()}` }),
    beginTrajectory: () => undefined,
    setTrajectoryRoute: () => undefined,
    endTrajectory: () => undefined,
  } as never;

  const ctx: RouterContext = {
    config: {
      mode: "full",
      logLevel: "info",
      llmModel: "qwen3.5:0.8b",
      dbUrl: TEST_DB_URL!,
      llmUrl: `http://127.0.0.1:${llmPort}`,
      embeddingModel: "qwen3-embedding:0.6b",
      embeddingDim: 1024,
      vectorPort: 8080,
      sonaEnabled: false,
      tokenFile: "/run/secrets/auth-token",
      internalApiKey: TEST_API_KEY,
      synthTimeoutMs: 15_000,
      recallProcessTimeoutMs: 180_000,
    },
    state,
    maxRequestBodyBytes: 1024 * 1024,
    embedText: async () => Array(1024).fill(0) as number[],
    getCachedEmbedding: async () => Array(1024).fill(0) as number[],
    synthesis: createOllamaSynthesis({
      llmUrl: `http://127.0.0.1:${llmPort}`,
      model: "qwen3.5:0.8b",
      defaultTimeoutMs: 15_000,
    }),
  };

  orchestratorServer = http.createServer((req, res) => {
    handleRequest(req, res, ctx).catch((error: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: String(error) }));
    });
  });

  await new Promise<void>((resolve) => {
    orchestratorServer.listen(0, "127.0.0.1", () => {
      const address = orchestratorServer.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to bind orchestrator test server");
      }
      orchestratorPort = address.port;
      resolve();
    });
  });
});

after(async () => {
  if (insertedMemoryIds.length > 0) {
    await pool.query(
      "DELETE FROM my_brain_memory_metadata WHERE memory_id = ANY($1::text[])",
      [insertedMemoryIds],
    );
  }

  await new Promise<void>((resolve, reject) => {
    orchestratorServer.close((error) => (error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    llmServer.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

describe("synthesis envelope status=ok", () => {
  it("returns envelope for all mb_* endpoints", async () => {
    llmMode = "ok";

    const remember = await request({
      method: "POST",
      path: "/v1/memory",
      body: {
        content: `remember ${Date.now()}`,
        type: "decision",
        scope: "repo",
        metadata: { repo: "test/repo", repo_name: "test/repo" },
      },
    });
    assert.equal(remember.status, 200);
    assertEnvelope(remember.body, "ok");
    const rememberedId = String(
      (remember.body.data as Record<string, unknown>)["memory_id"],
    );
    insertedMemoryIds.push(rememberedId);

    const recall = await request({
      method: "POST",
      path: "/v1/memory/recall",
      body: { query: "remember", top_k: 5, min_score: 0 },
    });
    assert.equal(recall.status, 200);
    assertEnvelope(recall.body, "ok");

    const vote = await request({
      method: "POST",
      path: "/v1/memory/vote",
      body: { memory_id: rememberedId, direction: "up" },
    });
    assert.equal(vote.status, 200);
    assertEnvelope(vote.body, "ok");

    const digest = await request({
      method: "POST",
      path: "/v1/memory/digest",
      body: { since: "7d" },
    });
    assert.equal(digest.status, 200);
    assertEnvelope(digest.body, "ok");

    const open = await request({
      method: "POST",
      path: "/v1/session/open",
      body: { agent: "integration" },
    });
    assert.equal(open.status, 200);
    assertEnvelope(open.body, "ok");
    const sessionId = String((open.body.data as Record<string, unknown>)["session_id"]);

    const close = await request({
      method: "POST",
      path: "/v1/session/close",
      body: { session_id: sessionId, success: true, quality: 0.8 },
    });
    assert.equal(close.status, 200);
    assertEnvelope(close.body, "ok");

    const forget = await request({
      method: "POST",
      path: "/v1/memory/forget",
      body: { memory_id: rememberedId, mode: "soft" },
    });
    assert.equal(forget.status, 200);
    assertEnvelope(forget.body, "ok");
  });
});

describe("synthesis envelope status=fallback", () => {
  it("returns fallback envelope when llm adapter fails", async () => {
    llmMode = "fail";

    const endpoints: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [
      {
        path: "/v1/memory",
        body: {
          content: `fallback remember ${Date.now()}`,
          type: "decision",
          scope: "repo",
          metadata: { repo: "test/repo", repo_name: "test/repo" },
        },
      },
      {
        path: "/v1/memory/recall",
        body: { query: "fallback query", top_k: 5, min_score: 0 },
      },
      {
        path: "/v1/memory/vote",
        body: { memory_id: insertedMemoryIds[0], direction: "up" },
      },
      {
        path: "/v1/memory/forget",
        body: { memory_id: insertedMemoryIds[0], mode: "soft" },
      },
      {
        path: "/v1/memory/digest",
        body: { since: "7d" },
      },
      {
        path: "/v1/session/open",
        body: { agent: "integration-fallback" },
      },
    ];

    for (const endpoint of endpoints) {
      const response = await request({
        method: "POST",
        path: endpoint.path,
        body: endpoint.body,
      });
      assert.equal(response.status, 200, `${endpoint.path} must return 200`);
      assertEnvelope(response.body, "fallback");
    }

    const open = await request({
      method: "POST",
      path: "/v1/session/open",
      body: { agent: "integration-fallback-close" },
    });
    assert.equal(open.status, 200);
    const sessionId = String((open.body.data as Record<string, unknown>)["session_id"]);

    const close = await request({
      method: "POST",
      path: "/v1/session/close",
      body: { session_id: sessionId, success: false, quality: 0.1 },
    });
    assert.equal(close.status, 200);
    assertEnvelope(close.body, "fallback");
  });
});
