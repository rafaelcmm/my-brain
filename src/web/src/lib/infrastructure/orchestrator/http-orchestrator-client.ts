import type { GraphSnapshot, Memory } from "@/lib/domain/types";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";
import {
  OrchestratorAuthError,
  OrchestratorUnavailableError,
  OrchestratorValidationError,
} from "@/lib/ports/orchestrator-client.port";
import { makeRequest } from "@/lib/infrastructure/http-request";

/**
 * HTTP implementation of OrchestratorClient.
 * Injects Authorization header and handles HTTP-specific errors.
 */
export class HttpOrchestratorClient implements OrchestratorClient {
  constructor(
    private baseUrl: string,
    private bearerToken: string,
    private internalKey: string,
  ) {}

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "X-Mybrain-Internal-Key": this.internalKey,
      "Content-Type": "application/json",
    };

    if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }

    return headers;
  }

  private async request(
    path: string,
    method: "GET" | "POST" | "DELETE" | "PATCH" = "GET",
    body?: unknown,
  ): Promise<unknown> {
    try {
      const url = `${this.baseUrl}${path}`;
      const { status, data } = await makeRequest(url, {
        method,
        headers: this.getHeaders(),
        body,
      });

      if (status === 401) {
        throw new OrchestratorAuthError(
          "Invalid or expired token",
        );
      }

      if (status >= 500) {
        throw new OrchestratorUnavailableError(
          `Orchestrator error: ${status}`,
        );
      }

      if (status >= 400) {
        throw new OrchestratorValidationError(
          `Request failed: ${status}`,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof OrchestratorAuthError ||
          error instanceof OrchestratorUnavailableError ||
          error instanceof OrchestratorValidationError) {
        throw error;
      }

      if (error instanceof TypeError) {
        throw new OrchestratorUnavailableError(
          `Connection failed: ${(error as Error).message}`,
        );
      }

      throw new OrchestratorUnavailableError(
        `Unknown error: ${(error as Error).message}`,
      );
    }
  }

  async getCapabilities(): Promise<{ version: string; mode: string }> {
    const data = (await this.request("/v1/capabilities")) as {
      capabilities?: { engine?: boolean };
    };

    return {
      version: "unknown",
      mode: data.capabilities?.engine ? "engine" : "fallback",
    };
  }

  async health(): Promise<boolean> {
    try {
      await this.request("/ready");
      return true;
    } catch {
      return false;
    }
  }

  async getBrainSummary(): Promise<{
    total_memories: number;
    by_scope: Record<string, number>;
    by_type: Record<string, number>;
    top_tags: Array<{ tag: string; count: number }>;
    top_frameworks: Array<{ framework: string; count: number }>;
    top_languages: Array<{ language: string; count: number }>;
    learning_stats: Record<string, number>;
  }> {
    const data = await this.request("/v1/memory/summary");
    return data as {
      total_memories: number;
      by_scope: Record<string, number>;
      by_type: Record<string, number>;
      top_tags: Array<{ tag: string; count: number }>;
      top_frameworks: Array<{ framework: string; count: number }>;
      top_languages: Array<{ language: string; count: number }>;
      learning_stats: Record<string, number>;
    };
  }

  async listMemories(
    filters?: Record<string, unknown>,
    cursor?: string,
  ): Promise<{ memories: Memory[]; next_cursor?: string | null }> {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      });
    }

    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await this.request(`/v1/memory/list${query}`);
    const parsed = data as { memories?: Memory[]; next_cursor?: string | null };

    return {
      memories: parsed.memories ?? [],
      next_cursor: parsed.next_cursor ?? null,
    };
  }

  async getMemory(id: string): Promise<unknown> {
    const data = await this.listMemories({ search: id }, "0");
    return data.memories.find((memory) => memory.id === id) ?? null;
  }

  async createMemory(
    content: string,
    type: string,
    scope: string,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("/v1/memory", "POST", {
      content,
      type,
      scope,
      metadata,
    });
  }

  async forgetMemory(id: string): Promise<void> {
    await this.request("/v1/memory/forget", "POST", { memory_id: id });
  }

  async getMemoryGraph(
    limit?: number,
    minSimilarity?: number,
  ): Promise<GraphSnapshot> {
    const params = new URLSearchParams();
    if (limit) params.append("limit", String(limit));
    if (minSimilarity) params.append("minSimilarity", String(minSimilarity));

    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await this.request(`/v1/memory/graph${query}`);
    return data as GraphSnapshot;
  }

  async recall(query: string, scope?: string): Promise<unknown> {
    return this.request("/v1/memory/recall", "POST", {
      query,
      scope,
    });
  }

  async digest(scope?: string, type?: string): Promise<unknown> {
    return this.request("/v1/memory/digest", "POST", {
      scope,
      type,
    });
  }
}
