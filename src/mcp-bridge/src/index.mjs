import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * @typedef {{name: string, description: string, inputSchema: Record<string, unknown>}} BridgeTool
 */

/**
 * Returns immutable bridge config used by runtime wiring.
 *
 * @returns {{restBaseUrl: string, upstreamCommand: string, upstreamArgs: string[], internalApiKey: string}} Runtime bridge config.
 */
function loadConfig() {
  return {
    restBaseUrl: process.env.MYBRAIN_REST_URL ?? "http://127.0.0.1:8080",
    upstreamCommand: process.env.MYBRAIN_UPSTREAM_MCP_COMMAND ?? "npx",
    upstreamArgs: process.env.MYBRAIN_UPSTREAM_MCP_ARGS?.split(" ").filter(
      Boolean,
    ) ?? ["-y", "ruvector", "mcp", "start"],
    internalApiKey: process.env.MYBRAIN_INTERNAL_API_KEY ?? "",
  };
}

const config = loadConfig();
const metrics = {
  counters: new Map(),
  histograms: new Map(),
};
let cachedCapabilities = null;
let cachedCapabilitiesAt = 0;
const bridgeCapabilitiesCacheMs = 10_000;
const LEGACY_PASSTHROUGH_ALLOWLIST = new Set(["hooks_stats"]);
incrementMetric(
  "mb_bridge_tool_calls_total",
  { tool: "none", status: "init" },
  0,
);
incrementMetric("mb_bridge_tools_list_total", {}, 0);
incrementMetric("mb_remember_total", {}, 0);
incrementMetric("mb_recall_total", { result: "miss" }, 0);
incrementMetric("mb_dedup_hits_total", {}, 0);
incrementMetric("mb_forget_total", { mode: "soft" }, 0);

/**
 * Increments bridge metrics counter with optional labels.
 *
 * @param {string} name Metric name.
 * @param {Record<string, string>} [labels] Optional labels.
 * @param {number} [delta] Increment amount.
 * @returns {void}
 */
function incrementMetric(name, labels = {}, delta = 1) {
  const labelEntries = Object.entries(labels).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const suffix = labelEntries
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const metricKey = suffix ? `${name}|${suffix}` : name;
  metrics.counters.set(
    metricKey,
    (metrics.counters.get(metricKey) ?? 0) + delta,
  );
}

/**
 * Renders bridge metrics in Prometheus text format.
 *
 * @returns {string} Prometheus exposition payload.
 */
function renderMetrics() {
  const lines = [];
  for (const [key, value] of metrics.counters.entries()) {
    const [name, labels] = key.split("|");
    if (!labels) {
      lines.push(`${name} ${value}`);
      continue;
    }

    const labelText = labels
      .split(",")
      .map((entry) => entry.split("="))
      .map(([labelKey, labelValue]) => `${labelKey}="${labelValue}"`)
      .join(",");
    lines.push(`${name}{${labelText}} ${value}`);
  }

  for (const [name, histogram] of metrics.histograms.entries()) {
    for (let index = 0; index < histogram.buckets.length; index += 1) {
      lines.push(
        `${name}_bucket{le="${histogram.buckets[index]}"} ${histogram.counts[index]}`,
      );
    }
    lines.push(`${name}_bucket{le="+Inf"} ${histogram.total}`);
    lines.push(`${name}_sum ${histogram.sum}`);
    lines.push(`${name}_count ${histogram.total}`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Observes duration values in milliseconds for fixed-bucket histograms.
 *
 * @param {string} name Metric name.
 * @param {number} valueMs Observed latency in milliseconds.
 * @returns {void}
 */
function observeDurationMs(name, valueMs) {
  const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  const existing = metrics.histograms.get(name) ?? {
    buckets,
    counts: new Array(buckets.length).fill(0),
    sum: 0,
    total: 0,
  };

  for (let index = 0; index < existing.buckets.length; index += 1) {
    if (valueMs <= existing.buckets[index]) {
      existing.counts[index] += 1;
    }
  }

  existing.sum += valueMs;
  existing.total += 1;
  metrics.histograms.set(name, existing);
}

/**
 * Compares secret values in constant time to avoid timing leaks.
 *
 * @param {string} provided Incoming secret value.
 * @param {string} expected Expected secret value.
 * @returns {boolean} True when both values are equal.
 */
function constantTimeEquals(provided, expected) {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Retrieves orchestrator capabilities with short-lived cache.
 *
 * @returns {Promise<Record<string, unknown>>} Capability object.
 */
async function getCapabilities() {
  const now = Date.now();
  if (
    cachedCapabilities &&
    now - cachedCapabilitiesAt < bridgeCapabilitiesCacheMs
  ) {
    return cachedCapabilities;
  }

  try {
    const headers = {};
    if (config.internalApiKey) {
      headers["x-mybrain-internal-key"] = config.internalApiKey;
    }

    const response = await fetch(`${config.restBaseUrl}/v1/capabilities`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(`capabilities status ${response.status}`);
    }
    const body = await response.json();
    cachedCapabilities = body.capabilities ?? {};
    cachedCapabilitiesAt = now;
    return cachedCapabilities;
  } catch {
    return cachedCapabilities ?? {};
  }
}

/**
 * Retrieves full orchestrator capabilities payload for legacy compatibility calls.
 *
 * @returns {Promise<Record<string, unknown>>} Raw capabilities response payload.
 */
async function getCapabilitiesPayload() {
  try {
    const headers = {};
    if (config.internalApiKey) {
      headers["x-mybrain-internal-key"] = config.internalApiKey;
    }

    const response = await fetch(`${config.restBaseUrl}/v1/capabilities`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(`capabilities status ${response.status}`);
    }

    const body = await response.json();
    return {
      success: body.success === true,
      capabilities: body.capabilities ?? {},
      features: body.features ?? {},
      degradedReasons: Array.isArray(body.degradedReasons)
        ? body.degradedReasons
        : [],
      db: body.db ?? {},
    };
  } catch {
    const capabilities = await getCapabilities();
    return {
      success: false,
      capabilities,
      features: {},
      degradedReasons: ["capabilities_unavailable"],
      db: {},
    };
  }
}

const bridgeTools = [
  {
    name: "hooks_capabilities",
    description:
      "Legacy compatibility endpoint returning orchestrator runtime capabilities",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mb_context_probe",
    description:
      "Return derived project context used by metadata-aware memory capture",
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description: "Reserved compatibility flag",
        },
        cwd: {
          type: "string",
          description: "Client workspace path hint used for context derivation",
        },
        git_remote: {
          type: "string",
          description: "Git remote hint from client when available",
        },
        repo_hint: {
          type: "string",
          description: "Repository hint when git remote is unavailable",
        },
        project_hint: {
          type: "string",
          description: "Project identifier hint from client workspace",
        },
        language_hint: {
          type: "string",
          description: "Primary language hint from active project",
        },
        framework_hints: {
          type: "array",
          items: { type: "string" },
          description: "Optional framework hints to avoid server-side stubs",
        },
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
    description:
      "Recall memory with scoped metadata filters and minimum score threshold",
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
        include_forgotten: { type: "boolean" },
        include_redacted: { type: "boolean" },
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
      Object.entries(process.env).filter(
        (entry) => typeof entry[1] === "string",
      ),
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
  const headers = { "content-type": "application/json" };
  if (config.internalApiKey) {
    headers["x-mybrain-internal-key"] = config.internalApiKey;
  }

  const response = await fetch(`${config.restBaseUrl}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const json = await response
    .json()
    .catch(() => ({ success: false, error: "invalid_response" }));
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
      "Use mb_* tools for memory operations. Legacy passthrough is restricted to supported compatibility tools only.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const allTools = [...bridgeTools];
  const capabilities = await getCapabilities();
  const engineReady = capabilities.engine === true;

  if (upstreamConnected) {
    try {
      const upstream = await upstreamClient.listTools();
      for (const tool of upstream.tools ?? []) {
        if (
          !LEGACY_PASSTHROUGH_ALLOWLIST.has(tool.name) ||
          (!engineReady && tool.name.startsWith("brain_"))
        ) {
          incrementMetric("mb_bridge_tools_filtered_total", {
            tool: tool.name,
          });
          continue;
        }
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

  incrementMetric("mb_bridge_tools_list_total");
  return { tools: allTools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const capabilities = await getCapabilities();
  const engineReady = capabilities.engine === true;

  if (!engineReady && name.startsWith("brain_")) {
    incrementMetric("mb_bridge_tool_calls_total", {
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
    case "hooks_capabilities":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      return asTextResult(await getCapabilitiesPayload());
    case "mb_context_probe":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      return asTextResult(
        await callOrchestrator("/v1/context/probe", args ?? {}),
      );
    case "mb_remember":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      {
        const result = await callOrchestrator("/v1/memory", args ?? {});
        if (result.success === true) {
          incrementMetric("mb_remember_total");
        }
        if (result.deduped === true) {
          incrementMetric("mb_dedup_hits_total");
        }
        return asTextResult(result);
      }
    case "mb_recall":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      {
        const startedAt = Date.now();
        const result = await callOrchestrator("/v1/memory/recall", args ?? {});
        observeDurationMs(
          "mb_bridge_recall_latency_ms",
          Date.now() - startedAt,
        );
        const isHit =
          Array.isArray(result.results) && result.results.length > 0;
        incrementMetric("mb_recall_total", { result: isHit ? "hit" : "miss" });
        return asTextResult(result);
      }
    case "mb_vote":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      return asTextResult(
        await callOrchestrator("/v1/memory/vote", args ?? {}),
      );
    case "mb_forget":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      {
        const result = await callOrchestrator("/v1/memory/forget", args ?? {});
        if (result.success === true) {
          incrementMetric("mb_forget_total", {
            mode: typeof result.mode === "string" ? result.mode : "soft",
          });
        }
        return asTextResult(result);
      }
    case "mb_session_open":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      return asTextResult(
        await callOrchestrator("/v1/session/open", args ?? {}),
      );
    case "mb_session_close":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      return asTextResult(
        await callOrchestrator("/v1/session/close", args ?? {}),
      );
    case "mb_digest":
      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "ok",
      });
      return asTextResult(
        await callOrchestrator("/v1/memory/digest", args ?? {}),
      );
    default:
      if (upstreamConnected && LEGACY_PASSTHROUGH_ALLOWLIST.has(name)) {
        incrementMetric("mb_bridge_tool_calls_total", {
          tool: name,
          status: "passthrough",
        });
        return upstreamClient.callTool({
          name,
          arguments: args ?? {},
        });
      }

      incrementMetric("mb_bridge_tool_calls_total", {
        tool: name,
        status: "error",
      });
      return asTextResult({
        success: false,
        error: "unsupported_tool",
        message: `tool not supported by bridge policy: ${name}`,
      });
  }
});

const metricsPort = Number.parseInt(
  process.env.MYBRAIN_PROMETHEUS_PORT ?? "9090",
  10,
);

if (Number.isFinite(metricsPort) && metricsPort > 0) {
  http
    .createServer((req, res) => {
      if (req.method === "GET" && req.url === "/metrics") {
        const header = req.headers["x-mybrain-internal-key"];
        const provided = Array.isArray(header) ? header[0] : header;
        if (
          !config.internalApiKey ||
          typeof provided !== "string" ||
          !constantTimeEquals(provided, config.internalApiKey)
        ) {
          res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          res.end("unauthorized");
          return;
        }

        res.writeHead(200, {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
        });
        res.end(renderMetrics());
        return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    })
    .listen(metricsPort, "0.0.0.0", () => {
      process.stderr.write(
        `[my-brain] bridge metrics listening on :${metricsPort}\n`,
      );
    });
}

await connectUpstream();

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write("[my-brain] bridge stdio server ready\n");
