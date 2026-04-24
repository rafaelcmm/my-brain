import type { BrainSummary, GraphSnapshot, Memory } from "@/lib/domain";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";
import {
  OrchestratorAuthError,
  OrchestratorUnavailableError,
  OrchestratorValidationError,
} from "@/lib/ports/orchestrator-client.port";
import { makeRequest } from "@/lib/infrastructure/http-request";
import {
  brainSummaryResponseSchema,
  capabilitiesResponseSchema,
  graphSnapshotResponseSchema,
  memoryByIdResponseSchema,
  memoryListResponseSchema,
} from "@/lib/infrastructure/orchestrator/dtos/orchestrator-response.dto";
import { mapMemoryDtoToDomain } from "@/lib/infrastructure/orchestrator/mappers/memory.mapper";

/**
 * HTTP implementation of OrchestratorClient.
 * Injects internal auth headers and translates transport failures to domain errors.
 */
export class HttpOrchestratorClient implements OrchestratorClient {
  constructor(
    private baseUrl: string,
    private bearerToken: string,
    private internalKey: string,
  ) {}

  /**
   * Build request headers for orchestrator traffic.
   *
   * Why centralized: keeps auth/header policy consistent across all endpoint calls.
   */
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

  /**
   * Execute request and normalize common HTTP-level failures.
   *
   * @param path Relative API path.
   * @param method HTTP method.
   * @param body Optional JSON body.
   * @returns Parsed response payload as unknown for per-endpoint validation.
   */
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
        throw new OrchestratorAuthError("Invalid or expired token");
      }

      if (status >= 500) {
        throw new OrchestratorUnavailableError(`Orchestrator error: ${status}`);
      }

      if (status >= 400) {
        throw new OrchestratorValidationError(`Request failed: ${status}`);
      }

      // All adapter endpoints are JSON contracts. String body indicates parse failure.
      if (typeof data === "string") {
        throw new OrchestratorValidationError("Malformed JSON response");
      }

      return data;
    } catch (error) {
      if (
        error instanceof OrchestratorAuthError ||
        error instanceof OrchestratorUnavailableError ||
        error instanceof OrchestratorValidationError
      ) {
        throw error;
      }

      if (error instanceof TypeError) {
        throw new OrchestratorUnavailableError(
          `Connection failed: ${error.message}`,
        );
      }

      throw new OrchestratorUnavailableError(
        `Unknown error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Parse transport payload with explicit runtime schema and standardized error.
   */
  private parsePayload<T>(
    parser: { parse: (value: unknown) => T },
    payload: unknown,
    endpoint: string,
  ): T {
    try {
      return parser.parse(payload);
    } catch (error) {
      throw new OrchestratorValidationError(
        `Invalid ${endpoint} payload: ${error instanceof Error ? error.message : "schema mismatch"}`,
      );
    }
  }

  async getCapabilities(): Promise<{ version: string; mode: string }> {
    const payload = await this.request("/v1/capabilities");
    const data = this.parsePayload(
      capabilitiesResponseSchema,
      payload,
      "/v1/capabilities",
    );

    return {
      version: data.db?.extensionVersion ?? "unavailable",
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

  async getBrainSummary(): Promise<BrainSummary> {
    const payload = await this.request("/v1/memory/summary");
    return this.parsePayload(
      brainSummaryResponseSchema,
      payload,
      "/v1/memory/summary",
    );
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
    const payload = await this.request(`/v1/memory/list${query}`);
    const data = this.parsePayload(
      memoryListResponseSchema,
      payload,
      "/v1/memory/list",
    );

    return {
      memories: data.memories.map(mapMemoryDtoToDomain),
      next_cursor: data.next_cursor ?? null,
    };
  }

  async getMemory(id: string): Promise<Memory | null> {
    let payload: unknown;
    try {
      payload = await this.request(`/v1/memory/${encodeURIComponent(id)}`);
    } catch (error) {
      if (
        error instanceof OrchestratorValidationError &&
        error.message.includes("Request failed: 404")
      ) {
        return null;
      }
      throw error;
    }

    const data = this.parsePayload(
      memoryByIdResponseSchema,
      payload,
      "/v1/memory/{id}",
    );
    return data ? mapMemoryDtoToDomain(data) : null;
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
    if (limit !== undefined) params.append("limit", String(limit));
    if (minSimilarity !== undefined)
      params.append("minSimilarity", String(minSimilarity));

    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await this.request(`/v1/memory/graph${query}`);
    // Cast required: Zod parses node/edge ids as plain string; domain uses branded MemoryId.
    // Data is validated by schema before this cast — no fabricated structure.
    return this.parsePayload(
      graphSnapshotResponseSchema,
      payload,
      "/v1/memory/graph",
    ) as unknown as GraphSnapshot;
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
