/**
 * Bridge tool descriptor exposed over MCP listTools.
 */
export interface BridgeTool {
  /** Tool identifier used in MCP requests. */
  readonly name: string;
  /** Human-readable purpose for tool discovery. */
  readonly description: string;
  /** JSON Schema payload definition for tool arguments. */
  readonly inputSchema: Record<string, unknown>;
}

/**
 * Runtime configuration for bridge process wiring.
 */
export interface BridgeConfig {
  /** Base URL for orchestrator REST API. */
  readonly restBaseUrl: string;
  /** Executable used to spawn legacy upstream MCP server. */
  readonly upstreamCommand: string;
  /** Arguments for upstream MCP command. */
  readonly upstreamArgs: readonly string[];
  /** Shared internal key for authenticated side-channel endpoints. */
  readonly internalApiKey: string;
  /** Port used for metrics HTTP endpoint; values <= 0 disable endpoint. */
  readonly metricsPort: number;
}

/**
 * Histogram sample storage used by Prometheus rendering.
 */
export interface HistogramState {
  /** Bucket upper bounds in milliseconds. */
  readonly buckets: readonly number[];
  /** Cumulative counts per bucket index. */
  readonly counts: number[];
  /** Sum of observed values. */
  sum: number;
  /** Total number of observed values. */
  total: number;
}

/**
 * Capability payload returned by orchestrator compatibility endpoint.
 */
export interface CapabilitiesPayload {
  /** Indicates whether live fetch succeeded. */
  readonly success: boolean;
  /** Dynamic capability switches used by bridge policy checks. */
  readonly capabilities: Record<string, unknown>;
  /** Additional feature flags from orchestrator response. */
  readonly features: Record<string, unknown>;
  /** Reasons for degraded mode when capabilities are unavailable. */
  readonly degradedReasons: readonly string[];
  /** Database health block forwarded for compatibility consumers. */
  readonly db: Record<string, unknown>;
}
