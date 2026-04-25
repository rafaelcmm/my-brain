import { BRIDGE_TOOLS } from "../../domain/tool-catalog.js";
import type { BridgeMetrics } from "../../domain/metrics.js";
import type { BridgeTool } from "../../domain/types.js";
import type { CapabilitiesClient } from "../../infrastructure/capabilities-client.js";

/**
 * Dependencies used by `listTools` request handler.
 */
export interface ListToolsDependencies {
  /** Metrics sink for list/filter counters. */
  readonly metrics: BridgeMetrics;
  /** Capabilities source used for engine gating. */
  readonly capabilitiesClient: CapabilitiesClient;
}

/**
 * Builds handler for MCP `listTools` while preserving legacy filtering semantics.
 *
 * @param deps Runtime dependencies injected during bootstrap.
 * @returns Async handler compatible with MCP server API.
 */
export function createListToolsHandler(deps: ListToolsDependencies) {
  return async (): Promise<{ tools: readonly BridgeTool[] }> => {
    // Fetch capabilities to preserve warm-cache behavior for follow-up callTool requests.
    await deps.capabilitiesClient.getCapabilities();

    deps.metrics.increment("mb_bridge_tools_list_total");
    return { tools: BRIDGE_TOOLS };
  };
}
