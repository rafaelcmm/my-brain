/**
 * Supported query tools proxied by webapp.
 */
export type QueryTool = "mb_recall" | "mb_digest";

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
  summary: string;
  data: unknown;
  synthesis: import("@/lib/domain/synthesis").SynthesisOutcome | null;
  raw: Record<string, unknown>;
  error?: string;
}
