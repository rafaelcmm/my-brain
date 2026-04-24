import { z } from "zod";
import type {
  ProcessedQueryModel,
  QueryMode,
  QueryRequest,
  QueryResponse,
} from "@/lib/domain";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";

const PROCESSED_QUERY_MODEL: ProcessedQueryModel = "qwen3.5:0.8b";

const queryRequestSchema = z.object({
  tool: z.enum(["mb_recall", "mb_digest", "mb_search"]),
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
      let data: unknown;

      if (request.tool === "mb_digest") {
        data = await this.client.digest(
          asOptionalString(request.params.scope),
          asOptionalString(request.params.type),
        );
      } else {
        const query = asOptionalString(request.params.query)?.trim();
        if (!query) {
          return {
            status: 400,
            latency_ms: Date.now() - startedAt,
            data: null,
            raw: { request },
            error: "query is required",
          };
        }

        const mode = resolveQueryMode(request.tool, request.params.mode);
        if (!mode) {
          return {
            status: 400,
            latency_ms: Date.now() - startedAt,
            data: null,
            raw: { request },
            error: "mode must be raw or processed",
          };
        }

        const modelResult = resolveProcessedModel(mode, request.params.model);
        if (modelResult.error) {
          return {
            status: 400,
            latency_ms: Date.now() - startedAt,
            data: null,
            raw: { request },
            error: modelResult.error,
          };
        }

        data = await this.client.recall(
          query,
          asOptionalString(request.params.scope),
          mode,
          modelResult.model,
        );
      }

      return {
        status: 200,
        latency_ms: Date.now() - startedAt,
        data,
        raw: {
          request,
          response: data,
        },
      };
    } catch (error) {
      return {
        status: 500,
        latency_ms: Date.now() - startedAt,
        data: null,
        raw: { request },
        error: error instanceof Error ? error.message : "Query failed",
      };
    }
  }
}

function resolveQueryMode(
  tool: "mb_recall" | "mb_search",
  rawMode: unknown,
): QueryMode | null {
  // Legacy mb_search behavior should remain processed when mode is omitted.
  if (tool === "mb_search" && rawMode === undefined) {
    return "processed";
  }

  const mode = asOptionalString(rawMode);
  if (!mode) {
    return "raw";
  }

  if (mode === "raw" || mode === "processed") {
    return mode;
  }

  return null;
}

function resolveProcessedModel(
  mode: QueryMode,
  rawModel: unknown,
): { model?: ProcessedQueryModel; error?: string } {
  const model = asOptionalString(rawModel);

  if (mode === "raw") {
    if (model) {
      return { error: "model is only allowed when mode is processed" };
    }
    return {};
  }

  if (model && model !== PROCESSED_QUERY_MODEL) {
    return {
      error: `processed mode only supports model ${PROCESSED_QUERY_MODEL}`,
    };
  }

  return { model: PROCESSED_QUERY_MODEL };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
