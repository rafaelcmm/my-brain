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
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      "X-Mybrain-Internal-Key": this.internalKey,
      "Content-Type": "application/json",
    };
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
    const data = await this.request("/v1/capabilities");
    return data as { version: string; mode: string };
  }

  async health(): Promise<boolean> {
    try {
      await this.request("/v1/capabilities");
      return true;
    } catch {
      return false;
    }
  }

  async getBrainSummary(): Promise<Record<string, unknown>> {
    const data = await this.request("/v1/memory/summary");
    return data as Record<string, unknown>;
  }

  async listMemories(
    filters?: Record<string, unknown>,
    cursor?: string,
  ): Promise<{ memories: unknown[]; next_cursor?: string }> {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, String(value));
      });
    }

    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await this.request(`/v1/memory/list${query}`);
    return data as { memories: unknown[]; next_cursor?: string };
  }

  async getMemory(id: string): Promise<unknown> {
    return this.request(`/v1/memory/${id}`);
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
    await this.request(`/v1/memory/${id}`, "DELETE");
  }

  async getMemoryGraph(
    limit?: number,
    minSimilarity?: number,
  ): Promise<{ nodes: unknown[]; edges: unknown[] }> {
    const params = new URLSearchParams();
    if (limit) params.append("limit", String(limit));
    if (minSimilarity) params.append("minSimilarity", String(minSimilarity));

    const query = params.toString() ? `?${params.toString()}` : "";
    const data = await this.request(`/v1/memory/graph${query}`);
    return data as { nodes: unknown[]; edges: unknown[] };
  }

  async recall(query: string, scope?: string): Promise<unknown> {
    return this.request("/v1/recall", "POST", {
      query,
      scope,
    });
  }

  async digest(scope?: string, type?: string): Promise<unknown> {
    return this.request("/v1/digest", "POST", {
      scope,
      type,
    });
  }
}
