import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";
import {
  OrchestratorAuthError,
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

describe("HttpOrchestratorClient contract", () => {
  it("injects auth and internal key headers", async () => {
    let authHeader = "";
    let internalHeader = "";

    server.use(
      http.post(`${baseUrl}/v1/memory/recall`, ({ request }) => {
        authHeader = request.headers.get("authorization") ?? "";
        internalHeader = request.headers.get("x-mybrain-internal-key") ?? "";
        return HttpResponse.json({ hits: [] });
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
        HttpResponse.json({ capabilities: { engine: true }, db: { extensionVersion: "1.2.3" } }),
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
          learning_stats: { upvotes: 1 },
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
      http.post(`${baseUrl}/v1/memory`, () => HttpResponse.json({ id: "m-2" })),
      http.post(`${baseUrl}/v1/memory/forget`, () =>
        HttpResponse.json({ ok: true }),
      ),
      http.get(`${baseUrl}/v1/memory/graph`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("minSimilarity")).toBe("0");
        return HttpResponse.json({ nodes: [], edges: [], total_count: 0 });
      }),
      http.post(`${baseUrl}/v1/memory/recall`, () =>
        HttpResponse.json({ hits: [] }),
      ),
      http.post(`${baseUrl}/v1/memory/digest`, () =>
        HttpResponse.json({ digest: [] }),
      ),
    );

    const client = createClient();

    await expect(client.getCapabilities()).resolves.toEqual({
      version: "1.2.3",
      mode: "engine",
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
    ).resolves.toEqual({ id: "m-2" });
    await expect(client.forgetMemory("m-1")).resolves.toBeUndefined();
    await expect(client.getMemoryGraph(50, 0)).resolves.toEqual({
      nodes: [],
      edges: [],
      total_count: 0,
    });
    await expect(client.recall("hello", "repo")).resolves.toEqual({ hits: [] });
    await expect(client.digest("repo", "decision")).resolves.toEqual({
      digest: [],
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
