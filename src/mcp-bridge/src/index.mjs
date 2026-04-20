import { createServer } from "node:http";

/**
 * Returns immutable bridge config used by runtime wiring.
 *
 * @returns {{host: string, port: number}} Bind configuration used by server.
 */
function loadConfig() {
  return {
    host: process.env.MYBRAIN_BRIDGE_HOST ?? "0.0.0.0",
    port: Number(process.env.MYBRAIN_BRIDGE_PORT ?? 3333),
  };
}

const config = loadConfig();

/**
 * Handles bridge bootstrap requests while mb facade is being wired.
 *
 * @param {import("node:http").IncomingMessage} req Incoming HTTP request.
 * @param {import("node:http").ServerResponse} res Outgoing HTTP response.
 * @returns {void}
 */
function handleRequest(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", service: "my-brain-mcp-bridge" }));
    return;
  }

  res.writeHead(501, { "content-type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      error: "not_implemented",
      message: "Bridge runtime scaffold only; MCP facade not wired yet",
    }),
  );
}

createServer(handleRequest).listen(config.port, config.host, () => {
  process.stdout.write(`[my-brain] mcp-bridge listening on ${config.host}:${config.port}\n`);
});
