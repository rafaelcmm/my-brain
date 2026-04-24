import { describe, expect, it, vi } from "vitest";
import { GetMemoryGraphUseCase } from "@/lib/application/get-memory-graph.usecase";

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
    recall: vi.fn(),
    digest: vi.fn(),
  };
}

describe("GetMemoryGraphUseCase", () => {
  it("uses default limit and degraded-mode similarity threshold", async () => {
    const client = createClient();
    client.getMemoryGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      total_count: 0,
    });

    const useCase = new GetMemoryGraphUseCase(client);
    const result = await useCase.execute();

    expect(result.total_count).toBe(0);
    expect(client.getMemoryGraph).toHaveBeenCalledWith(500, 0.85);
  });

  it("accepts explicit limit and zero similarity", async () => {
    const client = createClient();
    client.getMemoryGraph.mockResolvedValue({
      nodes: [
        { id: "m-1", label: "x", type: "decision", size: 1, scope: "repo" },
      ],
      edges: [],
      total_count: 1,
    });

    const useCase = new GetMemoryGraphUseCase(client);
    const result = await useCase.execute(50, 0);

    expect(result.total_count).toBe(1);
    expect(client.getMemoryGraph).toHaveBeenCalledWith(50, 0);
  });
});
