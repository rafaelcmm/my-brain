import type { SynthesisPort } from "../domain/synthesis.js";
import { buildPrompt } from "../application/synthesis/templates.js";
import { resolveGenerateEndpoint } from "./query-processing.js";

/**
 * Shape of a successful Ollama `/api/generate` response body.
 *
 * Ollama returns `response` for completion mode and `message.content` for
 * chat mode. Both paths are probed so the adapter works regardless of which
 * Ollama version or endpoint variant is configured.
 */
interface GeneratePayload {
  response?: unknown;
  message?: { content?: unknown };
}

/**
 * Normalises raw LLM output into a single-line string capped at 1 024
 * characters. Trims and collapses whitespace so synthesised summaries
 * render consistently across operator UIs that display them inline.
 *
 * @returns Empty string when output is absent so callers can treat falsy as
 *   synthesis failure rather than branching on undefined.
 */
function sanitizeOutput(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 1024);
}

/**
 * Detects common prompt-injection artifacts in synthesised output.
 *
 * Despite the <<<DATA>>> delimiter guard in the prompt, a capable model may
 * still regurgitate injected instructions from user-controlled memory content.
 * This filter rejects known exfiltration patterns so injected summaries never
 * reach clients. Additional patterns should be added conservatively — false
 * positives downgrade to fallback mode, which is preferable to leaking.
 *
 * @returns `true` when the output contains a recognised injection artefact.
 */
function hasInjectionArtifacts(value: string): boolean {
  return (
    /ignore\s+previous\s+instructions/i.test(value) ||
    /return\s+attacker/i.test(value) ||
    /^attacker\b/i.test(value)
  );
}

/**
 * Creates an Ollama-backed synthesis adapter implementing the synthesis port.
 *
 * @param opts - Runtime transport options for synth calls.
 * @returns Port implementation used by handlers to synthesize envelope summaries.
 */
export function createOllamaSynthesis(opts: {
  llmUrl: string;
  model: string;
  defaultTimeoutMs: number;
}): SynthesisPort {
  return {
    async synthesize(tool, question, data, timeoutMs) {
      const startedAt = Date.now();
      const endpoint = resolveGenerateEndpoint(opts.llmUrl);
      const effectiveTimeout = Math.max(
        timeoutMs || opts.defaultTimeoutMs,
        1_000,
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: opts.model,
            stream: false,
            think: false,
            prompt: buildPrompt(tool, question, data),
            options: {
              temperature: 0.2,
              top_p: 0.9,
              num_predict: 160,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`synthesis failed with status ${response.status}`);
        }

        const payload = (await response.json()) as GeneratePayload;
        const candidate =
          (typeof payload.response === "string"
            ? payload.response
            : undefined) ??
          (typeof payload.message?.content === "string"
            ? payload.message.content
            : undefined);
        const summary = sanitizeOutput(candidate);

        if (!summary) {
          throw new Error("synthesis returned empty response");
        }
        if (hasInjectionArtifacts(summary)) {
          throw new Error(
            "synthesis output rejected by injection safety filter",
          );
        }

        return {
          summary,
          model: opts.model,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`timeout after ${effectiveTimeout}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
