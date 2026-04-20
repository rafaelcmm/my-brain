import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * @typedef {{name: string, description: string, inputSchema: Record<string, unknown>}} BridgeTool
 */

/**
 * Returns immutable bridge config used by runtime wiring.
 *
 * @returns {{host: string, port: number}} Bind configuration used by server.
 */
function loadConfig() {
  return {
    restBaseUrl: process.env.MYBRAIN_REST_URL ?? "http://127.0.0.1:8080",
    upstreamCommand: process.env.MYBRAIN_UPSTREAM_MCP_COMMAND ?? "npx",
    upstreamArgs:
      process.env.MYBRAIN_UPSTREAM_MCP_ARGS?.split(" ").filter(Boolean) ?? [
        "-y",
        "ruvector",
        "mcp",
        "start",
      ],
  };
}

const config = loadConfig();

const bridgeTools = [
  {
    name: "mb_context_probe",
    description: "Return derived project context used by metadata-aware memory capture",
    inputSchema: {
      type: "object",
      properties: {
        refresh: { type: "boolean", description: "Reserved compatibility flag" },
      },
      required: [],
    },
  },
  {
    name: "mb_remember",
    description: "Store memory with metadata envelope",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        type: { type: "string" },
        scope: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["content", "type", "scope"],
    },
  },
  {
    name: "mb_recall",
    description: "Recall memory with scoped metadata filters and minimum score threshold",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "number" },
        scope: { type: "string" },
        repo: { type: "string" },
        project: { type: "string" },
        language: { type: "string" },
        frameworks: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        type: { type: "string" },
        include_expired: { type: "boolean" },
        min_score: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "mb_vote",
    description: "Register up/down vote for memory id",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        direction: { type: "string" },
        reason: { type: "string" },
      },
      required: ["memory_id", "direction"],
    },
  },
  {
    name: "mb_forget",
    description: "Soft/hard forget memory by id",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        mode: { type: "string", description: "soft or hard" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "mb_session_open",
    description: "Open tracked learning session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        agent: { type: "string" },
        context: { type: "object" },
      },
      required: [],
    },
  },
  {
    name: "mb_session_close",
    description: "Close tracked learning session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        success: { type: "boolean" },
        quality: { type: "number" },
        reason: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "mb_digest",
    description: "Summarize learned memories by type/language/repo",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string" },
      },
      required: [],
    },
  },
];

const upstreamClient = new Client(
  {
    name: "my-brain-mcp-bridge-upstream-client",
    version: "0.1.0",
  },
  {
    capabilities: {},
  },
);

let upstreamConnected = false;

/**
 * Connects to upstream ruvector MCP subprocess for legacy tool passthrough.
 *
 * @returns {Promise<void>}
 */
async function connectUpstream() {
  const transport = new StdioClientTransport({
    command: config.upstreamCommand,
    args: config.upstreamArgs,
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
    ),
  });

  try {
    await upstreamClient.connect(transport);
    upstreamConnected = true;
  } catch (error) {
    upstreamConnected = false;
    process.stderr.write(
      `[my-brain] bridge upstream connection failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * Executes REST request against orchestrator mb endpoints.
 *
 * @param {string} pathname Relative endpoint path.
 * @param {Record<string, unknown>} payload JSON payload.
 * @returns {Promise<Record<string, unknown>>} Parsed response object.
 */
async function callOrchestrator(pathname, payload) {
  const response = await fetch(`${config.restBaseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({ success: false, error: "invalid_response" }));
  return {
    http_status: response.status,
    ...json,
  };
}

/**
 * Wraps tool results into MCP text content blocks.
 *
 * @param {Record<string, unknown>} value Result payload.
 * @returns {{content: Array<{type: string, text: string}>}} MCP tool result.
 */
function asTextResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

/**
 * Handles bridge bootstrap requests while mb facade is being wired.
 *
 * @param {import("node:http").IncomingMessage} req Incoming HTTP request.
 * @param {import("node:http").ServerResponse} res Outgoing HTTP response.
 * @returns {void}
 */
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
      "Use mb_* tools for metadata-aware memory operations. Legacy hooks_* and brain_* remain available via passthrough.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const allTools = [...bridgeTools];

  if (upstreamConnected) {
    try {
      const upstream = await upstreamClient.listTools();
      for (const tool of upstream.tools ?? []) {
        if (!allTools.some((existing) => existing.name === tool.name)) {
          allTools.push(tool);
        }
      }
    } catch (error) {
      process.stderr.write(
        `[my-brain] bridge listTools passthrough failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  return { tools: allTools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "mb_context_probe":
      return asTextResult(await callOrchestrator("/v1/context/probe", args ?? {}));
    case "mb_remember":
      return asTextResult(await callOrchestrator("/v1/memory", args ?? {}));
    case "mb_recall":
      return asTextResult(await callOrchestrator("/v1/memory/recall", args ?? {}));
    case "mb_vote":
      return asTextResult(await callOrchestrator("/v1/memory/vote", args ?? {}));
    case "mb_forget":
      return asTextResult(await callOrchestrator("/v1/memory/forget", args ?? {}));
    case "mb_session_open":
      return asTextResult(await callOrchestrator("/v1/session/open", args ?? {}));
    case "mb_session_close":
      return asTextResult(await callOrchestrator("/v1/session/close", args ?? {}));
    case "mb_digest":
      return asTextResult(await callOrchestrator("/v1/memory/digest", args ?? {}));
    default:
      if (upstreamConnected) {
        return upstreamClient.callTool({
          name,
          arguments: args ?? {},
        });
      }

      return asTextResult({
        success: false,
        error: "upstream_unavailable",
        message: `legacy tool unavailable: ${name}`,
      });
  }
});

await connectUpstream();

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write("[my-brain] bridge stdio server ready\n");
