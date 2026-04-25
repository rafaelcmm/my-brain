/**
 * Canonical v2 tool response envelope returned by successful mb_* endpoints.
 *
 * @typeParam TData - Raw tool payload shape preserved in the envelope `data` field.
 */
export interface ToolResponseEnvelope<TData> {
  readonly success: true;
  readonly summary: string;
  readonly data: TData;
  readonly synthesis: SynthesisOutcome;
}

/**
 * Captures synthesis execution status and diagnostics for a tool response.
 */
export interface SynthesisOutcome {
  readonly status: "ok" | "fallback";
  readonly model: string;
  readonly latency_ms: number;
  readonly error?: string;
}

/**
 * Identifies which tool generated the response payload used for synthesis.
 */
export type SynthesisToolName =
  | "mb_capabilities"
  | "mb_context_probe"
  | "mb_remember"
  | "mb_recall"
  | "mb_vote"
  | "mb_forget"
  | "mb_session_open"
  | "mb_session_close"
  | "mb_digest";

/**
 * Port for synthesizing human-readable summaries from tool payloads.
 */
export interface SynthesisPort {
  /**
   * Generates summary text for a tool response payload.
   *
   * @param tool - Tool identifier selecting the synthesis prompt template.
   * @param question - Optional original user question associated with the request.
   * @param data - Raw tool payload that must remain source-of-truth.
   * @param timeoutMs - Hard timeout for synthesis execution in milliseconds.
   * @returns Synthesis summary and runtime metadata.
   */
  synthesize<T>(
    tool: SynthesisToolName,
    question: string | null,
    data: T,
    timeoutMs: number,
  ): Promise<{ summary: string; model: string; latencyMs: number }>;
}
