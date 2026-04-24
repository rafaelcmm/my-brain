import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";
import {
  OrchestratorAuthError,
  OrchestratorError,
  OrchestratorUnavailableError,
  OrchestratorValidationError,
} from "@/lib/ports/orchestrator-client.port";

const baseUrl = "http://orchestrator.test";

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

function createClient(): HttpOrchestratorClient {
  return new HttpOrchestratorClient(baseUrl, "bearer-token", "internal-key");
}

function envelope(data: unknown) {
  return {
    success: true,
    summary: "summary",
    data,
    synthesis: {
      status: "ok",
      model: "qwen3.5:0.8b",
      latency_ms: 10,
    },
  };
}

describe("HttpOrchestratorClient contract", () => {
  it("injects auth and internal key headers", async () => {
    let authHeader = "";
    let internalHeader = "";

    server.use(
      http.post(`${baseUrl}/v1/memory/recall`, ({ request }) => {
        authHeader = request.headers.get("authorization") ?? "";
        internalHeader = request.headers.get("x-mybrain-internal-key") ?? "";
        return HttpResponse.json(
          envelope({ query: "x", top_k: 8, min_score: 0.6, results: [] }),
        );
      }),
    );

    const client = createClient();
    await client.recall("hello world");

    expect(authHeader).toBe("Bearer bearer-token");
    expect(internalHeader).toBe("internal-key");
  });

  it("handles happy path for all adapter methods", async () => {
    server.use(
      http.get(`${baseUrl}/v1/capabilities`, () =>
        HttpResponse.json(
          envelope({
            capabilities: {
              engine: true,
              vectorDb: true,
              sona: true,
              attention: true,
              embeddingDim: 1024,
            },
            features: {
              vectorDb: true,
              sona: true,
              attention: true,
              embeddingDim: 1024,
            },
            degradedReasons: [],
            db: {
              extensionVersion: "1.2.3",
              adrSchemasReady: true,
              embeddingProvider: "ollama",
              embeddingReady: true,
            },
          }),
        ),
      ),
      http.get(`${baseUrl}/ready`, () => HttpResponse.json({ ok: true })),
      http.get(`${baseUrl}/v1/memory/summary`, () =>
        HttpResponse.json({
          total_memories: 1,
          by_scope: { repo: 1 },
          by_type: { decision: 1 },
          top_tags: [{ tag: "tag-a", count: 1 }],
          top_frameworks: [{ framework: "next", count: 1 }],
          top_languages: [{ language: "ts", count: 1 }],
          learning_stats: {
            sessions_opened: 1,
            sessions_closed: 1,
            successful_sessions: 1,
            failed_sessions: 0,
          },
        }),
      ),
      http.get(`${baseUrl}/v1/memory/list`, () =>
        HttpResponse.json({
          memories: [
            {
              id: "m-1",
              content: "hello",
              type: "decision",
              scope: "repo",
              created_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
              repo_name: "demo/repo",
              language: "typescript",
              tags: ["a"],
            },
          ],
          next_cursor: null,
        }),
      ),
      http.get(`${baseUrl}/v1/memory/m-1`, () =>
        HttpResponse.json({
          id: "m-1",
          content: "hello",
          type: "decision",
          scope: "repo",
          created_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          repo_name: "demo/repo",
          language: "typescript",
          tags: ["a"],
        }),
      ),
      http.post(`${baseUrl}/v1/memory`, () =>
        HttpResponse.json(
          envelope({
            memory_id: "m-2",
            scope: "repo",
            type: "decision",
            deduped: false,
          }),
        ),
      ),
      http.post(`${baseUrl}/v1/memory/forget`, () =>
        HttpResponse.json(envelope({ memory_id: "m-1", mode: "soft" })),
      ),
      http.get(`${baseUrl}/v1/memory/graph`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("minSimilarity")).toBe("0");
        return HttpResponse.json({ nodes: [], edges: [], total_count: 0 });
      }),
      http.post(`${baseUrl}/v1/memory/recall`, () =>
        HttpResponse.json(
          envelope({ query: "hello", top_k: 8, min_score: 0.6, results: [] }),
        ),
      ),
      http.post(`${baseUrl}/v1/memory/digest`, () =>
        HttpResponse.json(envelope({ since: "7d", rows: [], learning: {} })),
      ),
    );

    const client = createClient();

    await expect(client.getCapabilities()).resolves.toMatchObject({
      data: { db: { extensionVersion: "1.2.3" } },
    });
    await expect(client.health()).resolves.toBe(true);
    await expect(client.getBrainSummary()).resolves.toMatchObject({
      total_memories: 1,
    });
    await expect(client.listMemories()).resolves.toMatchObject({
      memories: [{ id: "m-1" }],
    });
    await expect(client.getMemory("m-1")).resolves.toMatchObject({ id: "m-1" });
    await expect(
      client.createMemory("body", "decision", "repo", {}),
    ).resolves.toMatchObject({ data: { memory_id: "m-2" } });
    await expect(client.forgetMemory("m-1")).resolves.toMatchObject({
      data: { memory_id: "m-1" },
    });
    await expect(client.getMemoryGraph(50, 0)).resolves.toEqual({
      nodes: [],
      edges: [],
      total_count: 0,
    });
    await expect(client.recall("hello", "repo")).resolves.toMatchObject({
      data: { query: "hello" },
    });
    await expect(client.digest("repo", "decision")).resolves.toMatchObject({
      data: { since: "7d" },
    });
  });

  it("maps 401 to OrchestratorAuthError", async () => {
    server.use(
      http.get(
        `${baseUrl}/v1/memory/summary`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );

    const client = createClient();
    await expect(client.getBrainSummary()).rejects.toBeInstanceOf(
      OrchestratorAuthError,
    );
  });

  it("maps 5xx to OrchestratorUnavailableError", async () => {
    server.use(
      http.post(
        `${baseUrl}/v1/memory/recall`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    );

    const client = createClient();
    await expect(client.recall("hello")).rejects.toBeInstanceOf(
      OrchestratorUnavailableError,
    );
  });

  it("maps malformed JSON success payload to OrchestratorValidationError", async () => {
    server.use(
      http.post(
        `${baseUrl}/v1/memory/recall`,
        () =>
          new HttpResponse("not-json", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const client = createClient();
    await expect(client.recall("hello")).rejects.toBeInstanceOf(
      OrchestratorValidationError,
    );
  });

  it("throws ENVELOPE_SHAPE_ERROR when tool endpoint returns legacy shape", async () => {
    server.use(
      http.post(`${baseUrl}/v1/memory/recall`, () =>
        HttpResponse.json({ hits: [] }),
      ),
    );

    const client = createClient();
    await expect(client.recall("hello")).rejects.toMatchObject({
      code: "ENVELOPE_SHAPE_ERROR",
    } satisfies Partial<OrchestratorError>);
  });

  it("rejects malformed summary/list/graph payloads with validation error", async () => {
    const client = createClient();

    server.use(
      http.get(`${baseUrl}/v1/memory/summary`, () =>
        HttpResponse.json({ total_memories: "nope" }),
      ),
    );
    await expect(client.getBrainSummary()).rejects.toBeInstanceOf(
      OrchestratorValidationError,
    );

    server.use(
      http.get(`${baseUrl}/v1/memory/list`, () =>
        HttpResponse.json({ memories: [{ id: 123 }] }),
      ),
    );
    await expect(client.listMemories()).rejects.toBeInstanceOf(
      OrchestratorValidationError,
    );

    server.use(
      http.get(`${baseUrl}/v1/memory/graph`, () =>
        HttpResponse.json({ nodes: "bad", edges: [], total_count: 0 }),
      ),
    );
    await expect(client.getMemoryGraph()).rejects.toBeInstanceOf(
      OrchestratorValidationError,
    );
  });
});
