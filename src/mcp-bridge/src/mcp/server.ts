import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolDependencies } from "./handlers/call-tool.js";
import { createCallToolHandler } from "./handlers/call-tool.js";
import type { ListToolsDependencies } from "./handlers/list-tools.js";
import { createListToolsHandler } from "./handlers/list-tools.js";

/**
 * Builds MCP bridge server with typed list/call handlers.
 *
 * @param listDeps Dependencies for listTools flow.
 * @param callDeps Dependencies for callTool flow.
 * @returns Configured MCP server instance.
 */
export function createBridgeServer(listDeps: ListToolsDependencies, callDeps: CallToolDependencies): Server {
  const server = new Server(
    {
      name: "my-brain-bridge",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Use mb_* tools for memory operations. Legacy passthrough is restricted to supported compatibility tools only.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, createListToolsHandler(listDeps));
  server.setRequestHandler(CallToolRequestSchema, createCallToolHandler(callDeps));
  return server;
}
