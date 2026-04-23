import { describe, expect, it, vi } from "vitest";
import { RunQueryUseCase } from "@/lib/application/run-query.usecase";

function createClient() {
  return {
    getCapabilities: vi.fn(),
    health: vi.fn(),
    getBrainSummary: vi.fn(),
    listMemories: vi.fn(),
    getMemory: vi.fn(),
    createMemory: vi.fn(),
    forgetMemory: vi.fn(),
    getMemoryGraph: vi.fn(),
    recall: vi.fn(async () => ({ hits: [] })),
    digest: vi.fn(async () => ({ digest: [] })),
  };
}

describe("RunQueryUseCase", () => {
  it("runs recall path", async () => {
    const client = createClient();
    const useCase = new RunQueryUseCase(client);

    const result = await useCase.execute({
      tool: "mb_recall",
      params: { query: "hello" },
    });

    expect(client.recall).toHaveBeenCalledWith("hello", undefined);
    expect(result.status).toBe(200);
    expect(result.error).toBeUndefined();
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

  it("rejects missing query for recall-like tools", async () => {
    const client = createClient();
    const useCase = new RunQueryUseCase(client);

    const result = await useCase.execute({
      tool: "mb_search",
      params: {},
    });

    expect(result.status).toBe(400);
    expect(result.error).toBe("query is required");
  });
});
