import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config/load-config.js";
import { BridgeMetrics, seedMetrics } from "../domain/metrics.js";
import { CapabilitiesClient } from "../infrastructure/capabilities-client.js";
import { startMetricsServer } from "../infrastructure/metrics-http.js";
import { OrchestratorClient } from "../infrastructure/orchestrator-client.js";
import { createBridgeServer } from "../mcp/server.js";

/**
 * Starts bridge runtime, including optional metrics endpoint and MCP stdio transport.
 */
export async function startBridge(): Promise<void> {
  const config = loadConfig();
  const metrics = new BridgeMetrics();
  seedMetrics(metrics);

  const capabilitiesClient = new CapabilitiesClient(config);
  const orchestratorClient = new OrchestratorClient(config);

  startMetricsServer(config, metrics);

  const server = createBridgeServer(
    {
      metrics,
      capabilitiesClient,
    },
    {
      metrics,
      capabilitiesClient,
      orchestratorClient,
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[my-brain] bridge stdio server ready\n");
}
