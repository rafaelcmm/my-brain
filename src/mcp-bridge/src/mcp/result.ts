export interface EnvelopeLike {
  readonly success: true;
  readonly summary: string;
  readonly data: unknown;
  readonly synthesis: {
    readonly status: "ok" | "fallback";
    readonly model: string;
    readonly latency_ms: number;
    readonly error?: string;
  };
}

/**
 * Checks whether a value matches the orchestrator v2 synthesis envelope shape.
 *
 * @param value - Candidate payload.
 * @returns True when payload is envelope-like.
 */
export function isEnvelope(value: unknown): value is EnvelopeLike {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate["success"] === true &&
    typeof candidate["summary"] === "string" &&
    "data" in candidate &&
    typeof candidate["synthesis"] === "object" &&
    candidate["synthesis"] !== null
  );
}

/**
 * Wraps plain JSON payload into MCP text content result format.
 *
 * @param value Serializable payload returned by bridge handlers.
 * @returns MCP-compatible content envelope.
 */
export function asTextResult(value: unknown) {
  if (isEnvelope(value)) {
    return {
      content: [
        {
          type: "text",
          text: value.summary || JSON.stringify(value.data),
        },
        {
          type: "json",
          json: value,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
