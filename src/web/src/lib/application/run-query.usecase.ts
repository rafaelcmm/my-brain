import { z } from "zod";
import type {
  QueryRequest,
  QueryResponse,
  ToolResponseEnvelope,
} from "@/lib/domain";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";

const queryRequestSchema = z.object({
  tool: z.enum(["mb_recall", "mb_digest"]),
  params: z.record(z.unknown()),
});

/**
 * Executes supported query tools and returns a normalized envelope for UI rendering.
 */
export class RunQueryUseCase {
  constructor(private readonly client: OrchestratorClient) {}

  /**
   * Runs one tool call against orchestrator and returns latency + status metadata.
   */
  async execute(input: QueryRequest): Promise<QueryResponse> {
    const request = queryRequestSchema.parse(input);
    const startedAt = Date.now();

    try {
      let envelope: ToolResponseEnvelope<unknown>;

      if (request.tool === "mb_digest") {
        envelope = await this.client.digest(
          asOptionalString(request.params.scope),
          asOptionalString(request.params.type),
        );
      } else {
        const query = asOptionalString(request.params.query)?.trim();
        if (!query) {
          return emptyErrorResponse(
            startedAt,
            request,
            "query is required",
            400,
          );
        }

        envelope = await this.client.recall(
          query,
          asOptionalString(request.params.scope),
        );
      }

      return {
        status: 200,
        latency_ms: Date.now() - startedAt,
        summary: envelope.summary,
        data: envelope.data,
        synthesis: envelope.synthesis,
        raw: {
          request,
          response: envelope,
        },
      };
    } catch (error) {
      return {
        status: 500,
        latency_ms: Date.now() - startedAt,
        summary: "",
        data: null,
        synthesis: null,
        raw: { request },
        error: error instanceof Error ? error.message : "Query failed",
      };
    }
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function emptyErrorResponse(
  startedAt: number,
  request: QueryRequest,
  error: string,
  status = 400,
): QueryResponse {
  return {
    status,
    latency_ms: Date.now() - startedAt,
    summary: "",
    data: null,
    synthesis: null,
    raw: { request },
    error,
  };
}
