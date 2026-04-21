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
 * Validates upstream command executable name.
 *
 * @param raw Raw command string from environment.
 * @returns Validated command string.
 * @throws {Error} When command contains shell metacharacters.
 */
function validateCommand(raw: string): string {
  // Prevent shell metacharacters that could enable injection.
  const dangerousChars = /[;&|`$()<>]/;
  if (dangerousChars.test(raw)) {
    throw new Error(
      `MYBRAIN_UPSTREAM_MCP_COMMAND contains dangerous shell characters: ${raw}`,
    );
  }

  return raw;
}

/**
 * Splits optional upstream argument string into command tokens.
 *
 * @param raw Raw argument string from environment.
 * @returns Tokenized argument list with stable defaults.
 */
function parseUpstreamArgs(raw: string | undefined): readonly string[] {
  const tokens = raw?.split(" ").filter(Boolean) ?? [];
  if (tokens.length > 0) {
    return tokens;
  }

  return ["-y", "ruvector", "mcp", "start"];
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
  const rawCommand = process.env.MYBRAIN_UPSTREAM_MCP_COMMAND ?? "npx";

  return {
    restBaseUrl: validateBaseUrl(rawBaseUrl),
    upstreamCommand: validateCommand(rawCommand),
    upstreamArgs: parseUpstreamArgs(process.env.MYBRAIN_UPSTREAM_MCP_ARGS),
    internalApiKey: process.env.MYBRAIN_INTERNAL_API_KEY ?? "",
    metricsPort: Number.isFinite(rawPort) ? rawPort : 9090,
  };
}
