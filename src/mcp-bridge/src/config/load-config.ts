import type { BridgeConfig } from "../domain/types.js";

/**
 * Validates and normalizes HTTP(S) base URL.
 *
 * @param raw Raw URL string from environment.
 * @returns Validated URL without trailing slash.
 * @throws {Error} When URL is invalid or uses non-HTTP protocol.
 */
function validateBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`MYBRAIN_REST_URL is not a valid URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `MYBRAIN_REST_URL must use http:// or https://, got: ${parsed.protocol}`,
    );
  }

  // Remove trailing slash for consistent path concatenation.
  return parsed.href.replace(/\/$/, "");
}

/**
 * Resolves immutable runtime configuration for bridge bootstrap.
 *
 * @returns Runtime config consumed by transport and HTTP clients.
 */
export function loadConfig(): BridgeConfig {
  const rawPort = Number.parseInt(
    process.env.MYBRAIN_PROMETHEUS_PORT ?? "9090",
    10,
  );
  const rawBaseUrl = process.env.MYBRAIN_REST_URL ?? "http://127.0.0.1:8080";

  return {
    restBaseUrl: validateBaseUrl(rawBaseUrl),
    internalApiKey: process.env.MYBRAIN_INTERNAL_API_KEY ?? "",
    metricsPort: Number.isFinite(rawPort) ? rawPort : 9090,
  };
}
