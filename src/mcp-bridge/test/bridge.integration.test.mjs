import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Starts mock orchestrator API used by bridge integration tests.
 *
 * @param {{engine: boolean}} options Capability mode for mock responses.
 * @returns {Promise<{baseUrl: string, close: () => Promise<void>}>}
 */
async function startMockOrchestrator(options) {
  const server = createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "GET" && req.url === "/v1/capabilities") {
      send(200, {
        success: true,
        capabilities: { engine: options.engine },
        features: {},
        degradedReasons: [],
        db: {},
      });
      return;
    }

    if (req.method !== "POST") {
      send(404, { success: false, error: "not_found" });
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      const parsed = body.length > 0 ? JSON.parse(body) : {};
      switch (req.url) {
        case "/v1/context/probe":
          send(200, { success: true, context: { cwd: parsed.cwd ?? null } });
          break;
        case "/v1/memory":
          send(200, { success: true, memory_id: "m1", deduped: true });
          break;
        case "/v1/memory/recall":
          send(200, {
            success: true,
            results: [{ memory_id: "m1", score: 0.99 }],
          });
          break;
        case "/v1/memory/vote":
          send(200, { success: true, direction: parsed.direction ?? "up" });
          break;
        case "/v1/memory/forget":
          send(200, { success: true, mode: parsed.mode ?? "soft" });
          break;
        case "/v1/session/open":
          send(200, { success: true, session_id: parsed.session_id ?? "s1" });
          break;
        case "/v1/session/close":
          send(200, { success: true, session_id: parsed.session_id ?? "s1" });
          break;
        case "/v1/memory/digest":
          send(200, { success: true, digest: [] });
          break;
        default:
          send(404, { success: false, error: "not_found" });
      }
    });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock orchestrator failed to bind TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

/**
 * Finds free localhost TCP port.
 *
 * @returns {Promise<number>} Available port number.
 */
async function getFreePort() {
  const server = createServer();
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate free TCP port");
  }
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return address.port;
}

/**
 * Connects MCP client to bridge subprocess using stdio transport.
 *
 * @param {{restBaseUrl: string, metricsPort: number, internalKey: string, engine: boolean}} options Runtime env values.
 * @returns {Promise<{client: Client, transport: StdioClientTransport}>} Connected MCP client and transport.
 */
async function connectBridgeClient(options) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      MYBRAIN_REST_URL: options.restBaseUrl,
      MYBRAIN_PROMETHEUS_PORT: String(options.metricsPort),
      MYBRAIN_INTERNAL_API_KEY: options.internalKey,
    },
    stderr: "pipe",
  });

  const client = new Client(
    {
      name: "bridge-integration-test",
      version: "0.1.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);
  return { client, transport };
}

/**
 * Parses JSON payload from bridge text content response.
 *
 * @param {{structuredContent?: Record<string, unknown>, content?: Array<{type: string, text?: string}>}} result MCP tool result.
 * @returns {Record<string, unknown>} Parsed payload object.
 */
function parseToolResult(result) {
  if (
    result.structuredContent &&
    typeof result.structuredContent === "object"
  ) {
    return result.structuredContent;
  }

  const textEntry = result.content?.find((entry) => entry.type === "text");
  assert.ok(textEntry?.text, "expected text content from bridge tool result");
  return JSON.parse(textEntry.text);
}

test("bridge supports full mb tool surface and metrics auth", async () => {
  const internalKey = "test-internal-key";
  const metricsPort = await getFreePort();
  const orchestrator = await startMockOrchestrator({ engine: true });

  const { client, transport } = await connectBridgeClient({
    restBaseUrl: orchestrator.baseUrl,
    metricsPort,
    internalKey,
    engine: true,
  });

  try {
    const tools = await client.listTools();
    const names = new Set((tools.tools ?? []).map((tool) => tool.name));

    assert.ok(names.has("mb_capabilities"));
    assert.ok(names.has("mb_context_probe"));
    assert.ok(names.has("mb_remember"));
    assert.ok(names.has("mb_recall"));
    assert.ok(names.has("mb_vote"));
    assert.ok(names.has("mb_forget"));
    assert.ok(names.has("mb_session_open"));
    assert.ok(names.has("mb_session_close"));
    assert.ok(names.has("mb_digest"));

    const canonicalCapabilities = parseToolResult(
      await client.callTool({ name: "mb_capabilities", arguments: {} }),
    );
    assert.equal(canonicalCapabilities.success, true);
    assert.equal(canonicalCapabilities.capabilities?.engine, true);

    const contextProbe = parseToolResult(
      await client.callTool({
        name: "mb_context_probe",
        arguments: { cwd: "/tmp/workspace" },
      }),
    );
    assert.equal(contextProbe.success, true);

    const remember = parseToolResult(
      await client.callTool({
        name: "mb_remember",
        arguments: { content: "x", type: "note", scope: "repo" },
      }),
    );
    assert.equal(remember.success, true);
    assert.equal(remember.deduped, true);

    const recall = parseToolResult(
      await client.callTool({ name: "mb_recall", arguments: { query: "x" } }),
    );
    assert.equal(recall.success, true);
    assert.equal(Array.isArray(recall.results), true);

    const vote = parseToolResult(
      await client.callTool({
        name: "mb_vote",
        arguments: { memory_id: "m1", direction: "up" },
      }),
    );
    assert.equal(vote.success, true);

    const forget = parseToolResult(
      await client.callTool({
        name: "mb_forget",
        arguments: { memory_id: "m1", mode: "soft" },
      }),
    );
    assert.equal(forget.success, true);

    const sessionOpen = parseToolResult(
      await client.callTool({ name: "mb_session_open", arguments: {} }),
    );
    assert.equal(sessionOpen.success, true);

    const sessionClose = parseToolResult(
      await client.callTool({
        name: "mb_session_close",
        arguments: { session_id: "s1" },
      }),
    );
    assert.equal(sessionClose.success, true);

    const digest = parseToolResult(
      await client.callTool({ name: "mb_digest", arguments: {} }),
    );
    assert.equal(digest.success, true);

    const unsupported = parseToolResult(
      await client.callTool({ name: "not_supported", arguments: {} }),
    );
    assert.equal(unsupported.success, false);
    assert.equal(unsupported.error, "unsupported_tool");

    const unauthorized = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${metricsPort}/metrics`, {
      headers: { "x-mybrain-internal-key": internalKey },
    });
    assert.equal(authorized.status, 200);
    const metricsBody = await authorized.text();
    assert.match(metricsBody, /mb_bridge_tool_calls_total/);
    assert.match(metricsBody, /mb_bridge_tools_list_total/);
  } finally {
    await client.close();
    await transport.close();
    await orchestrator.close();
  }
});

test("bridge blocks brain_* tools when engine capability disabled", async () => {
  const internalKey = "test-internal-key";
  const metricsPort = await getFreePort();
  const orchestrator = await startMockOrchestrator({ engine: false });

  const { client, transport } = await connectBridgeClient({
    restBaseUrl: orchestrator.baseUrl,
    metricsPort,
    internalKey,
    engine: false,
  });

  try {
    const blocked = parseToolResult(
      await client.callTool({ name: "brain_recall", arguments: {} }),
    );
    assert.equal(blocked.success, false);
    assert.equal(blocked.error, "engine_disabled");
  } finally {
    await client.close();
    await transport.close();
    await orchestrator.close();
  }
});
