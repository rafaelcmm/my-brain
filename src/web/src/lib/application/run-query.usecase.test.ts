import { describe, expect, it, vi } from "vitest";
import { RunQueryUseCase } from "@/lib/application/run-query.usecase";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";

function makeRecallEnvelope() {
  return {
    success: true as const,
    summary: "Two memories match the query.",
    data: {
      query: "q",
      top_k: 8,
      min_score: 0.6,
      results: [],
    },
    synthesis: {
      status: "ok" as const,
      model: "qwen3.5:0.8b",
      latency_ms: 120,
    },
  };
}

function makeDigestEnvelope() {
  return {
    success: true as const,
    summary: "Two memories match the query.",
    data: {
      since: "7d",
      rows: [],
      learning: {},
    },
    synthesis: {
      status: "ok" as const,
      model: "qwen3.5:0.8b",
      latency_ms: 120,
    },
  };
}

function createClient(): OrchestratorClient {
  return {
    getCapabilities: vi.fn(),
    health: vi.fn(),
    getBrainSummary: vi.fn(),
    listMemories: vi.fn(),
    getMemory: vi.fn(),
    createMemory: vi.fn(),
    forgetMemory: vi.fn(),
    getMemoryGraph: vi.fn(),
    recall: vi.fn(async () => makeRecallEnvelope()),
    digest: vi.fn(async () => makeDigestEnvelope()),
  };
}

describe("RunQueryUseCase", () => {
  it("maps recall envelope summary into QueryResponse", async () => {
    const client = createClient();
    const useCase = new RunQueryUseCase(client);

    const result = await useCase.execute({
      tool: "mb_recall",
      params: { query: "hello" },
    });

    expect(client.recall).toHaveBeenCalledWith("hello", undefined);
    expect(result.status).toBe(200);
    expect(result.summary).toBe("Two memories match the query.");
    expect(result.synthesis?.status).toBe("ok");
  });

  it("runs digest path", async () => {
    const client = createClient();
    const useCase = new RunQueryUseCase(client);

    const result = await useCase.execute({
      tool: "mb_digest",
      params: { scope: "repo", type: "fix" },
    });

    expect(client.digest).toHaveBeenCalledWith("repo", "fix");
    expect(result.status).toBe(200);
  });

  it("rejects missing query for recall", async () => {
    const client = createClient();
    const useCase = new RunQueryUseCase(client);

    const result = await useCase.execute({
      tool: "mb_recall",
      params: {},
    });

    expect(result.status).toBe(400);
    expect(result.error).toBe("query is required");
  });

  it("returns synthesis null on error path", async () => {
    const client = createClient();
    const failingRecall: OrchestratorClient["recall"] = async () => {
      throw new Error("orchestrator down");
    };
    client.recall = vi.fn(failingRecall);

    const useCase = new RunQueryUseCase(client);
    const result = await useCase.execute({
      tool: "mb_recall",
      params: { query: "hello" },
    });

    expect(result.status).toBe(500);
    expect(result.synthesis).toBeNull();
    expect(result.summary).toBe("");
  });
});
