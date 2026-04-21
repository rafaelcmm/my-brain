import type { BridgeConfig, CapabilitiesPayload } from "../domain/types.js";

/**
 * Retrieves orchestrator capabilities with short-lived cache to reduce hot-path latency.
 */
export class CapabilitiesClient {
  private cachedCapabilities: Record<string, unknown> | null = null;

  private cachedCapabilitiesAt = 0;

  private readonly cacheMs = 10_000;

  /**
   * @param config Runtime bridge configuration.
   */
  constructor(private readonly config: BridgeConfig) {}

  /**
   * Returns capability object for policy checks.
   *
   * @returns Capabilities map, potentially from short-lived cache.
   */
  async getCapabilities(): Promise<Record<string, unknown>> {
    const now = Date.now();
    if (this.cachedCapabilities && now - this.cachedCapabilitiesAt < this.cacheMs) {
      return this.cachedCapabilities;
    }

    try {
      const response = await fetch(`${this.config.restBaseUrl}/v1/capabilities`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) {
        throw new Error(`capabilities status ${response.status}`);
      }

      const body = (await response.json()) as { capabilities?: Record<string, unknown> };
      this.cachedCapabilities = body.capabilities ?? {};
      this.cachedCapabilitiesAt = now;
      return this.cachedCapabilities;
    } catch {
      return this.cachedCapabilities ?? {};
    }
  }

  /**
   * Returns full compatibility payload for `hooks_capabilities`.
   *
   * @returns Capabilities payload matching legacy bridge response contract.
   */
  async getCapabilitiesPayload(): Promise<CapabilitiesPayload> {
    try {
      const response = await fetch(`${this.config.restBaseUrl}/v1/capabilities`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) {
        throw new Error(`capabilities status ${response.status}`);
      }

      const body = (await response.json()) as {
        success?: boolean;
        capabilities?: Record<string, unknown>;
        features?: Record<string, unknown>;
        degradedReasons?: unknown;
        db?: Record<string, unknown>;
      };

      return {
        success: body.success === true,
        capabilities: body.capabilities ?? {},
        features: body.features ?? {},
        degradedReasons: Array.isArray(body.degradedReasons)
          ? body.degradedReasons.filter((value): value is string => typeof value === "string")
          : [],
        db: body.db ?? {},
      };
    } catch {
      return {
        success: false,
        capabilities: await this.getCapabilities(),
        features: {},
        degradedReasons: ["capabilities_unavailable"],
        db: {},
      };
    }
  }

  /**
   * Builds internal auth headers for orchestrator calls.
   *
   * @returns Header dictionary for fetch requests.
   */
  private buildHeaders(): Record<string, string> {
    if (!this.config.internalApiKey) {
      return {};
    }

    return {
      "x-mybrain-internal-key": this.config.internalApiKey,
    };
  }
}
