import { describe, expect, it, vi } from "vitest";
import { GetBrainSummaryUseCase } from "@/lib/application/get-brain-summary.usecase";

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

describe("GetBrainSummaryUseCase", () => {
  it("returns summary payload from orchestrator", async () => {
    const client = createClient();
    client.getBrainSummary.mockResolvedValue({
      total_memories: 2,
      by_scope: { repo: 2 },
      by_type: { decision: 1, fix: 1 },
      top_tags: [{ tag: "x", count: 2 }],
      top_frameworks: [{ framework: "next", count: 1 }],
      top_languages: [{ language: "typescript", count: 2 }],
      learning_stats: {
        sessions_opened: 1,
        sessions_closed: 1,
        successful_sessions: 1,
        failed_sessions: 0,
      },
    });

    const useCase = new GetBrainSummaryUseCase(client);
    const result = await useCase.execute();

    expect(result.total_memories).toBe(2);
    expect(client.getBrainSummary).toHaveBeenCalledTimes(1);
  });

  it("supports empty summary response", async () => {
    const client = createClient();
    client.getBrainSummary.mockResolvedValue({
      total_memories: 0,
      by_scope: {},
      by_type: {},
      top_tags: [],
      top_frameworks: [],
      top_languages: [],
      learning_stats: {
        sessions_opened: 0,
        sessions_closed: 0,
        successful_sessions: 0,
        failed_sessions: 0,
      },
    });

    const useCase = new GetBrainSummaryUseCase(client);
    const result = await useCase.execute();

    expect(result.top_tags).toEqual([]);
    expect(result.learning_stats).toEqual({
      sessions_opened: 0,
      sessions_closed: 0,
      successful_sessions: 0,
      failed_sessions: 0,
    });
  });
});
