/**
 * Query preprocessing adapter for recall requests.
 *
 * Processed mode rewrites an operator query into a tighter retrieval-focused form.
 * Keeping this logic in infrastructure isolates external LLM transport details
 * from HTTP handlers and scoring domain logic.
 */

export interface ProcessRecallQueryOptions {
  llmUrl: string;
  model: string;
  query: string;
  timeoutMs?: number;
}

export interface ProcessedRecallQuery {
  originalQuery: string;
  processedQuery: string;
  model: string;
  latencyMs: number;
}

export interface RecallSynthesisEntry {
  id: string;
  content: string;
  score: number;
}

export interface SynthesizeRecallAnswerOptions {
  llmUrl: string;
  model: string;
  question: string;
  results: RecallSynthesisEntry[];
  timeoutMs?: number;
}

export interface SynthesizedRecallAnswer {
  answer: string;
  model: string;
  latencyMs: number;
}

const QUERY_REWRITE_INSTRUCTIONS = [
  "Rewrite user input into one compact memory-recall query.",
  "Keep intent, entities, time hints, repo/language constraints.",
  "No explanations, no markdown, no quotes.",
  "Output only rewritten query text.",
].join(" ");

const ANSWER_SYNTHESIS_INSTRUCTIONS = [
  "Answer the user question using only the provided memory snippets.",
  "Be concise and practical.",
  "Cite snippet ids in square brackets for each key claim, for example [mem-123].",
  "If snippets are insufficient, explicitly say what is missing.",
  "Output plain text only.",
].join(" ");

/**
 * Rewrites a recall query through the configured Ollama endpoint.
 *
 * Failure is propagated to caller so the API can decide strict or fallback behavior.
 */
export async function processRecallQuery(
  options: ProcessRecallQueryOptions,
): Promise<ProcessedRecallQuery> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(options.timeoutMs ?? 10_000, 1_000);
  const endpoint = resolveGenerateEndpoint(options.llmUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        think: false,
        prompt: `${QUERY_REWRITE_INSTRUCTIONS}\n\nInput: ${options.query}`,
        options: {
          temperature: 0.1,
          top_p: 0.9,
          num_predict: 80,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`query processing failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      response?: unknown;
      message?: { content?: unknown };
    };
    const candidate =
      (typeof payload.response === "string" ? payload.response : undefined) ??
      (typeof payload.message?.content === "string"
        ? payload.message.content
        : undefined);

    const processedQuery = sanitizeProcessedQuery(candidate);
    if (!processedQuery) {
      throw new Error("query processing returned empty response");
    }

    return {
      originalQuery: options.query,
      processedQuery,
      model: options.model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`query processing timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Produces a semantic answer grounded in ranked recall results.
 *
 * This is intentionally separate from retrieval so callers can still return
 * ranked memories when synthesis fails.
 */
export async function synthesizeRecallAnswer(
  options: SynthesizeRecallAnswerOptions,
): Promise<SynthesizedRecallAnswer> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(options.timeoutMs ?? 15_000, 1_000);
  const endpoint = resolveGenerateEndpoint(options.llmUrl);

  const snippets = options.results
    .slice(0, 5)
    .map(
      (entry) =>
        `id=${entry.id}; score=${entry.score.toFixed(3)}; content=${entry.content.slice(0, 1200)}`,
    )
    .join("\n\n");

  const prompt = [
    ANSWER_SYNTHESIS_INSTRUCTIONS,
    "",
    `Question: ${options.question}`,
    "",
    `Snippets:\n${snippets}`,
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        think: false,
        prompt,
        options: {
          temperature: 0.2,
          top_p: 0.9,
          num_predict: 320,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`answer synthesis failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      response?: unknown;
      message?: { content?: unknown };
    };
    const candidate =
      (typeof payload.response === "string" ? payload.response : undefined) ??
      (typeof payload.message?.content === "string"
        ? payload.message.content
        : undefined);
    const answer = sanitizeSynthesisAnswer(candidate);

    if (!answer) {
      throw new Error("answer synthesis returned empty response");
    }

    return {
      answer,
      model: options.model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`answer synthesis timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeProcessedQuery(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 1024);
}

function sanitizeSynthesisAnswer(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 4096);
}

function resolveGenerateEndpoint(llmUrl: string): string {
  const normalized = llmUrl.trim();
  if (!normalized) {
    throw new Error("MYBRAIN_LLM_URL is required for processed query mode");
  }

  if (normalized.endsWith("/api/generate")) {
    return normalized;
  }

  return `${normalized.replace(/\/$/, "")}/api/generate`;
}
