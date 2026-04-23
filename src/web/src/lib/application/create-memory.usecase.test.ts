import { describe, expect, it, vi } from "vitest";
import { CreateMemoryUseCase } from "@/lib/application/create-memory.usecase";

describe("CreateMemoryUseCase", () => {
  it("creates memory with validated input", async () => {
    const createMemory = vi.fn(async () => ({ id: "m-1" }));
    const useCase = new CreateMemoryUseCase({
      getCapabilities: vi.fn(),
      health: vi.fn(),
      getBrainSummary: vi.fn(),
      listMemories: vi.fn(),
      getMemory: vi.fn(),
      createMemory,
      forgetMemory: vi.fn(),
      getMemoryGraph: vi.fn(),
      recall: vi.fn(),
      digest: vi.fn(),
    });

    const result = await useCase.execute({
      content: "hello",
      type: "decision",
      scope: "repo",
      metadata: { repo: "test/repo" },
    });

    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: "m-1" });
  });

  it("rejects invalid payload", async () => {
    const useCase = new CreateMemoryUseCase({
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
    });

    await expect(
      useCase.execute({
        content: "",
        type: "decision",
        scope: "repo",
        metadata: {},
      }),
    ).rejects.toThrow();
  });
});
