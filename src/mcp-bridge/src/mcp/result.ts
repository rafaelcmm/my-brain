/**
 * Wraps plain JSON payload into MCP text content result format.
 *
 * @param value Serializable payload returned by bridge handlers.
 * @returns MCP-compatible content envelope.
 */
export function asTextResult(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
