import type { SynthesisPort } from "../domain/synthesis.js";
import { buildPrompt } from "../application/synthesis/templates.js";
import { resolveGenerateEndpoint } from "./query-processing.js";

interface GeneratePayload {
  response?: unknown;
  message?: { content?: unknown };
}

function sanitizeOutput(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 1024);
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
      const effectiveTimeout = Math.max(timeoutMs || opts.defaultTimeoutMs, 1_000);
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
          (typeof payload.response === "string" ? payload.response : undefined) ??
          (typeof payload.message?.content === "string"
            ? payload.message.content
            : undefined);
        const summary = sanitizeOutput(candidate);

        if (!summary) {
          throw new Error("synthesis returned empty response");
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
