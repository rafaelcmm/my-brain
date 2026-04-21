import type { BridgeConfig } from "../domain/types.js";

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
  const rawPort = Number.parseInt(process.env.MYBRAIN_PROMETHEUS_PORT ?? "9090", 10);

  return {
    restBaseUrl: process.env.MYBRAIN_REST_URL ?? "http://127.0.0.1:8080",
    upstreamCommand: process.env.MYBRAIN_UPSTREAM_MCP_COMMAND ?? "npx",
    upstreamArgs: parseUpstreamArgs(process.env.MYBRAIN_UPSTREAM_MCP_ARGS),
    internalApiKey: process.env.MYBRAIN_INTERNAL_API_KEY ?? "",
    metricsPort: Number.isFinite(rawPort) ? rawPort : 9090,
  };
}
