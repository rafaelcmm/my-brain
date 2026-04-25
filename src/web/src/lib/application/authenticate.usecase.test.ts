import { describe, expect, it, vi } from "vitest";
import { AuthenticateUseCase } from "./authenticate.usecase";
import type {
  OrchestratorClient,
  SessionStore,
} from "../ports/orchestrator-client.port";
import { OrchestratorAuthError } from "../ports/orchestrator-client.port";

function createSessionStoreMock(): SessionStore {
  return {
    createSession: vi.fn(async () => "session-1"),
    getBearer: vi.fn(async () => null),
    destroySession: vi.fn(async () => undefined),
    verifyCSRFToken: vi.fn(async () => true),
    getCSRFToken: vi.fn(async () => "csrf"),
  };
}

/**
 * AuthenticateUseCase tests token validation and session creation contract.
 */
describe("AuthenticateUseCase", () => {
  it("creates session after capabilities check succeeds", async () => {
    const sessionStore = createSessionStoreMock();
    const client: OrchestratorClient = {
      getCapabilities: vi.fn(async () => ({
        success: true as const,
        summary: "capabilities ok",
        data: {
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
            extensionVersion: "x",
            adrSchemasReady: true,
            embeddingProvider: "ollama",
            embeddingReady: true,
          },
        },
        synthesis: {
          status: "ok" as const,
          model: "qwen3.5:0.8b",
          latency_ms: 10,
        },
      })),
      health: vi.fn(async () => true),
      getBrainSummary: vi.fn(),
      listMemories: vi.fn(),
      getMemory: vi.fn(),
      createMemory: vi.fn(),
      forgetMemory: vi.fn(),
      getMemoryGraph: vi.fn(),
      recall: vi.fn(),
      digest: vi.fn(),
    };

    const useCase = new AuthenticateUseCase(() => client, sessionStore);
    const sessionId = await useCase.authenticate("token-123");

    expect(sessionId).toBe("session-1");
    expect(client.getCapabilities).toHaveBeenCalledOnce();
    expect(sessionStore.createSession).toHaveBeenCalledWith("token-123");
  });

  it("maps auth failures to invalid token message", async () => {
    const sessionStore = createSessionStoreMock();
    const client: OrchestratorClient = {
      getCapabilities: vi.fn(async () => {
        throw new OrchestratorAuthError("bad token");
      }),
      health: vi.fn(async () => true),
      getBrainSummary: vi.fn(),
      listMemories: vi.fn(),
      getMemory: vi.fn(),
      createMemory: vi.fn(),
      forgetMemory: vi.fn(),
      getMemoryGraph: vi.fn(),
      recall: vi.fn(),
      digest: vi.fn(),
    };

    const useCase = new AuthenticateUseCase(() => client, sessionStore);

    await expect(useCase.authenticate("bad")).rejects.toThrow(
      "Invalid or expired token",
    );
    expect(sessionStore.createSession).not.toHaveBeenCalled();
  });
});
