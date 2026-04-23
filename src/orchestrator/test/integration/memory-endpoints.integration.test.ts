/**
 * Integration tests for metadata-backed memory endpoints.
 *
 * Uses real Postgres + real HTTP server. No mocks.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { createInitialRuntimeState } from "../../src/bootstrap/runtime.js";
import { handleRequest } from "../../src/http/router.js";
import type { RouterContext } from "../../src/http/router.js";
import {
  createPool,
  initializeDatabase,
} from "../../src/infrastructure/postgres.js";
import { persistMemoryMetadata } from "../../src/infrastructure/postgres-memory.js";
import type { Pool } from "pg";
import type { MemoryEnvelope } from "../../src/domain/types.js";

const TEST_DB_URL = process.env["TEST_DB_URL"];
const TEST_API_KEY = "test-internal-key";

if (!TEST_DB_URL) {
  console.log(
    "[integration] Skipping memory-endpoints suite — TEST_DB_URL not set.",
  );
  process.exit(0);
}

function makeEnvelope(i: number): MemoryEnvelope {
  return {
    content: `Endpoint fixture memory ${i}`,
    type: i % 2 === 0 ? "decision" : "fix",
    scope: i % 3 === 0 ? "repo" : "project",
    metadata: {
      repo: "github.com/test/repo",
      repo_name: "test/repo",
      project: "test-project",
      language: i % 2 === 0 ? "typescript" : "python",
      frameworks: i % 2 === 0 ? ["nextjs"] : ["fastapi"],
      tags: i % 2 === 0 ? ["web", "memory"] : ["api", "memory"],
      embedding: Array.from({ length: 1024 }, (_, idx) =>
        idx === i % 16 ? 1 : 0,
      ),
    },
  };
}

function request(opts: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; body: unknown; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const payload =
      opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const started = performance.now();

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
          const latencyMs = performance.now() - started;
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(raw),
              latencyMs,
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw, latencyMs });
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

let pool: Pool;
let server: http.Server;
let port = 0;
let insertedIds: string[] = [];

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

  for (let i = 0; i < 120; i += 1) {
    const id = `endpoint-${Date.now()}-${i}`;
    insertedIds.push(id);
    await persistMemoryMetadata(pool, id, makeEnvelope(i));
  }

  const state = createInitialRuntimeState(1024);
  state.pool = pool;
  state.db.connected = true;

  const ctx: RouterContext = {
    config: {
      mode: "full",
      logLevel: "info",
      llmModel: "qwen3.5:0.8b",
      dbUrl: TEST_DB_URL!,
      llmUrl: "http://127.0.0.1:11434",
      embeddingModel: "qwen3-embedding:0.6b",
      embeddingDim: 1024,
      vectorPort: 8080,
      sonaEnabled: false,
      tokenFile: "/run/secrets/auth-token",
      internalApiKey: TEST_API_KEY,
    },
    state,
    maxRequestBodyBytes: 1024 * 1024,
    embedText: async () => Array(1024).fill(0) as number[],
    getCachedEmbedding: async () => Array(1024).fill(0) as number[],
    backfill: async () => ({ processed: 0, updated: 0, failed: 0, skipped: 0 }),
  };

  server = http.createServer((req, res) => {
    handleRequest(req, res, ctx).catch((error: unknown) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: String(error) }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      port = addr.port;
      resolve();
    });
  });
});

after(async () => {
  if (insertedIds.length > 0) {
    await pool.query(
      "DELETE FROM my_brain_memory_metadata WHERE memory_id = ANY($1::text[])",
      [insertedIds],
    );
  }

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

describe("GET /v1/memory/summary", () => {
  it("returns expected aggregate shape", async () => {
    const response = await request({
      port,
      path: "/v1/memory/summary",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });

    assert.equal(response.status, 200);
    const payload = response.body as Record<string, unknown>;

    assert.equal(payload.success, true);
    assert.equal(typeof payload.total_memories, "number");
    assert.equal(typeof payload.by_scope, "object");
    assert.equal(typeof payload.by_type, "object");
    assert.ok(Array.isArray(payload.top_tags));
    assert.ok(Array.isArray(payload.top_frameworks));
    assert.ok(Array.isArray(payload.top_languages));
  });
});

describe("GET /v1/memory/list", () => {
  it("returns paginated list sorted by recency", async () => {
    const response = await request({
      port,
      path: "/v1/memory/list?limit=10&repo_name=test/repo",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });

    assert.equal(response.status, 200);
    const payload = response.body as Record<string, unknown>;
    assert.equal(payload.success, true);

    const memories = payload.memories as Array<Record<string, unknown>>;
    assert.equal(memories.length, 10);
    assert.equal(typeof payload.next_cursor, "string");

    const dates = memories.map((memory) =>
      Date.parse(String(memory.last_seen_at)),
    );
    for (let i = 1; i < dates.length; i += 1) {
      assert.ok(
        dates[i - 1]! >= dates[i]!,
        "list must be sorted by last_seen_at desc",
      );
    }
  });

  it("keeps p95 latency under 500ms for endpoint reads", async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 20; i += 1) {
      const response = await request({
        port,
        path: "/v1/memory/list?limit=25&repo_name=test/repo",
        headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
      });
      assert.equal(response.status, 200);
      latencies.push(response.latencyMs);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95) - 1;
    const p95 = latencies[Math.max(0, p95Index)] ?? 0;
    assert.ok(p95 < 500, `expected p95 < 500ms, got ${p95.toFixed(2)}ms`);
  });
});

describe("GET /v1/memory/graph", () => {
  it("returns graph payload with nodes and edges", async () => {
    const response = await request({
      port,
      path: "/v1/memory/graph?limit=50",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });

    assert.equal(response.status, 200);
    const payload = response.body as Record<string, unknown>;
    assert.equal(payload.success, true);

    const nodes = payload.nodes as Array<Record<string, unknown>>;
    const edges = payload.edges as Array<Record<string, unknown>>;

    assert.ok(nodes.length > 0, "graph must include nodes");
    assert.ok(Array.isArray(edges), "graph edges must be an array");
  });
});

describe("GET /v1/memory/{id}", () => {
  it("returns exact memory by id", async () => {
    const targetId = insertedIds[0];
    assert.ok(targetId, "seeded test memory id must exist");

    const response = await request({
      port,
      path: `/v1/memory/${encodeURIComponent(targetId)}`,
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });

    assert.equal(response.status, 200);
    const payload = response.body as Record<string, unknown>;
    assert.equal(payload.id, targetId);
  });

  it("returns 404 for unknown id", async () => {
    const response = await request({
      port,
      path: "/v1/memory/does-not-exist",
      headers: { "X-Mybrain-Internal-Key": TEST_API_KEY },
    });

    assert.equal(response.status, 404);
  });
});
