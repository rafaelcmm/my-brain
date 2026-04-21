import {
  BRIDGE_TOOLS,
  LEGACY_PASSTHROUGH_ALLOWLIST,
} from "../../domain/tool-catalog.js";
import type { BridgeMetrics } from "../../domain/metrics.js";
import type { BridgeTool } from "../../domain/types.js";
import type { CapabilitiesClient } from "../../infrastructure/capabilities-client.js";
import type { UpstreamClient } from "../../infrastructure/upstream-client.js";

/**
 * Dependencies used by `listTools` request handler.
 */
export interface ListToolsDependencies {
  /** Metrics sink for list/filter counters. */
  readonly metrics: BridgeMetrics;
  /** Capabilities source used for engine gating. */
  readonly capabilitiesClient: CapabilitiesClient;
  /** Optional upstream passthrough source. */
  readonly upstreamClient: UpstreamClient;
}

/**
 * Builds handler for MCP `listTools` while preserving legacy filtering semantics.
 *
 * @param deps Runtime dependencies injected during bootstrap.
 * @returns Async handler compatible with MCP server API.
 */
export function createListToolsHandler(deps: ListToolsDependencies) {
  return async (): Promise<{ tools: readonly BridgeTool[] }> => {
    const allTools = [...BRIDGE_TOOLS];
    const capabilities = await deps.capabilitiesClient.getCapabilities();
    const engineReady = capabilities.engine === true;

    if (deps.upstreamClient.isConnected()) {
      try {
        const upstreamTools = await deps.upstreamClient.listTools();
        for (const tool of upstreamTools) {
          if (
            !LEGACY_PASSTHROUGH_ALLOWLIST.has(tool.name) ||
            (!engineReady && tool.name.startsWith("brain_"))
          ) {
            deps.metrics.increment("mb_bridge_tools_filtered_total", {
              tool: tool.name,
            });
            continue;
          }

          if (!allTools.some((existing) => existing.name === tool.name)) {
            allTools.push(tool);
          }
        }
      } catch (error) {
        // Sanitize error to avoid leaking internal details.
        const message =
          error instanceof Error ? error.message : "unknown error";
        const sanitized =
          message.length > 200 ? message.slice(0, 200) + "..." : message;
        process.stderr.write(
          `[my-brain] bridge listTools passthrough failed: ${sanitized}\n`,
        );
      }
    }

    deps.metrics.increment("mb_bridge_tools_list_total");
    return { tools: allTools };
  };
}
