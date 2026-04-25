import type {
  SynthesisToolName,
  ToolResponseEnvelope,
} from "../../domain/synthesis.js";
import {
  incrementMetric,
  observeDurationMs,
} from "../../observability/metrics.js";
import type { RouterContext } from "../router-context.js";

/**
 * Wraps successful tool data with synthesis metadata.
 *
 * This helper never throws. When synthesis fails, callers still receive the
 * original raw data with `synthesis.status = "fallback"` and empty summary.
 *
 * @typeParam T - Raw tool payload shape.
 * @param ctx - Router context with synthesis adapter and config.
 * @param tool - Tool identifier selecting synthesis template.
 * @param question - Optional user question associated with the payload.
 * @param data - Raw payload that remains source-of-truth for callers.
 * @returns Canonical tool response envelope.
 */
export async function wrapWithSynthesis<T>(
  ctx: RouterContext,
  tool: SynthesisToolName,
  question: string | null,
  data: T,
): Promise<ToolResponseEnvelope<T>> {
  const startedAt = Date.now();

  try {
    const synthesized = await ctx.synthesis.synthesize(
      tool,
      question,
      data,
      ctx.config.synthTimeoutMs,
    );
    incrementMetric("mb_synthesis_total", { tool, status: "ok" });
    observeDurationMs("mb_synthesis_latency_ms", synthesized.latencyMs);

    return {
      success: true,
      summary: synthesized.summary,
      data,
      synthesis: {
        status: "ok",
        model: synthesized.model,
        latency_ms: synthesized.latencyMs,
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    incrementMetric("mb_synthesis_total", { tool, status: "fallback" });
    observeDurationMs("mb_synthesis_latency_ms", latencyMs);

    return {
      success: true,
      summary: "",
      data,
      synthesis: {
        status: "fallback",
        model: ctx.config.llmModel,
        latency_ms: latencyMs,
        error: error instanceof Error ? error.message : "synthesis failed",
      },
    };
  }
}
