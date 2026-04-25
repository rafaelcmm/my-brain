import type { BridgeMetrics } from "../../domain/metrics.js";
import type { CapabilitiesClient } from "../../infrastructure/capabilities-client.js";
import type { OrchestratorClient } from "../../infrastructure/orchestrator-client.js";
import { asTextResult } from "../result.js";

/**
 * Dependencies used by `callTool` request handler.
 */
export interface CallToolDependencies {
  /** Metrics sink used for tool call counters and latency. */
  readonly metrics: BridgeMetrics;
  /** Capabilities source used for engine gating and compatibility tool payload. */
  readonly capabilitiesClient: CapabilitiesClient;
  /** REST orchestrator client for mb_* tool execution. */
  readonly orchestratorClient: OrchestratorClient;
}

/**
 * Minimal MCP callTool payload shape consumed by bridge.
 */
interface CallToolRequestLike {
  readonly params: {
    readonly name: string;
    readonly arguments?: Record<string, unknown> | undefined;
  };
}

/**
 * Creates request handler for MCP `callTool` preserving existing tool contract.
 *
 * @param deps Runtime dependencies injected during bootstrap.
 * @returns Async handler compatible with MCP server request API.
 */
export function createCallToolHandler(deps: CallToolDependencies) {
  return async (request: CallToolRequestLike) => {
    const { name, arguments: args } = request.params;

    // Sanitize arguments: reject null/undefined, default to empty object.
    const sanitizedArgs =
      args != null && typeof args === "object" && !Array.isArray(args)
        ? args
        : {};

    const capabilities = await deps.capabilitiesClient.getCapabilities();
    const engineReady = capabilities.engine === true;

    if (!engineReady && name.startsWith("brain_")) {
      deps.metrics.increment("mb_bridge_tool_calls_total", {
        tool: name,
        status: "blocked",
      });
      return asTextResult({
        success: false,
        error: "engine_disabled",
        message: `tool unavailable while engine=false: ${name}`,
      });
    }

    switch (name) {
      case "mb_capabilities": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        return asTextResult(
          await deps.capabilitiesClient.getCapabilitiesPayload(),
        );
      }
      case "mb_context_probe": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        return asTextResult(
          await deps.orchestratorClient.call(
            "/v1/context/probe",
            sanitizedArgs,
          ),
        );
      }
      case "mb_remember": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        const result = await deps.orchestratorClient.call(
          "/v1/memory",
          sanitizedArgs,
        );
        if (result.success === true) {
          deps.metrics.increment("mb_remember_total");
        }
        if (result.deduped === true) {
          deps.metrics.increment("mb_dedup_hits_total");
        }
        return asTextResult(result);
      }
      case "mb_recall": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        const startedAt = Date.now();
        const result = await deps.orchestratorClient.call(
          "/v1/memory/recall",
          sanitizedArgs,
        );
        deps.metrics.observeDurationMs(
          "mb_bridge_recall_latency_ms",
          Date.now() - startedAt,
        );
        const isHit =
          Array.isArray(result.results) && result.results.length > 0;
        deps.metrics.increment("mb_recall_total", {
          result: isHit ? "hit" : "miss",
        });
        return asTextResult(result);
      }
      case "mb_vote": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        return asTextResult(
          await deps.orchestratorClient.call("/v1/memory/vote", sanitizedArgs),
        );
      }
      case "mb_forget": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        const result = await deps.orchestratorClient.call(
          "/v1/memory/forget",
          sanitizedArgs,
        );
        if (result.success === true) {
          deps.metrics.increment("mb_forget_total", {
            mode: typeof result.mode === "string" ? result.mode : "soft",
          });
        }
        return asTextResult(result);
      }
      case "mb_session_open": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        return asTextResult(
          await deps.orchestratorClient.call("/v1/session/open", sanitizedArgs),
        );
      }
      case "mb_session_close": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        return asTextResult(
          await deps.orchestratorClient.call(
            "/v1/session/close",
            sanitizedArgs,
          ),
        );
      }
      case "mb_digest": {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "ok",
        });
        return asTextResult(
          await deps.orchestratorClient.call(
            "/v1/memory/digest",
            sanitizedArgs,
          ),
        );
      }
      default: {
        deps.metrics.increment("mb_bridge_tool_calls_total", {
          tool: name,
          status: "error",
        });
        return asTextResult({
          success: false,
          error: "unsupported_tool",
          message: `tool not supported by bridge policy: ${name}`,
        });
      }
    }
  };
}
