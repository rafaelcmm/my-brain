import type { BridgeConfig } from "../domain/types.js";

/**
 * Executes JSON POST requests against orchestrator mb endpoints.
 */
export class OrchestratorClient {
  /**
   * @param config Runtime bridge configuration.
   */
  constructor(private readonly config: BridgeConfig) {}

  /**
   * Calls orchestrator endpoint and always returns parsed object with `http_status`.
   *
   * @param pathname Relative path under orchestrator base URL.
   * @param payload Arbitrary JSON payload forwarded from MCP call.
   * @returns Response envelope preserving compatibility fields.
   */
  async call(
    pathname: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.config.internalApiKey) {
      headers["x-mybrain-internal-key"] = this.config.internalApiKey;
    }

    const response = await fetch(`${this.config.restBaseUrl}${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const body = (await response
      .json()
      .catch(() => ({ success: false, error: "invalid_response" }))) as Record<
      string,
      unknown
    >;

    return {
      http_status: response.status,
      ...body,
    };
  }
}
