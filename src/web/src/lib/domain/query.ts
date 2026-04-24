/**
 * Supported query tools proxied by webapp.
 */
export type QueryTool = "mb_recall" | "mb_digest" | "mb_search";

/**
 * Query execution mode for recall-like tools.
 */
export type QueryMode = "raw" | "processed";

/**
 * Processed mode currently supports one pinned model to keep evaluation deterministic.
 */
export type ProcessedQueryModel = "qwen3.5:0.8b";

/**
 * Query request envelope.
 */
export interface QueryRequest {
  tool: QueryTool;
  params: Record<string, unknown>;
}

/**
 * Query response envelope with both parsed and raw payloads.
 */
export interface QueryResponse {
  status: number;
  latency_ms: number;
  data: unknown;
  raw: Record<string, unknown>;
  error?: string;
}
