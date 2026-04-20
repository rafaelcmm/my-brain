import http from "node:http";

/**
 * Parses a boolean-like environment variable while keeping defaults explicit.
 *
 * @param {string | undefined} value Raw environment value.
 * @param {boolean} fallback Boolean used when input is missing or malformed.
 * @returns {boolean} Parsed boolean that preserves operator intent.
 */
function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

/**
 * Loads runtime configuration once so handlers remain deterministic.
 *
 * @returns {{
 * mode: string,
 * logLevel: string,
 * llmModel: string,
 * dbUrl: string,
 * llmUrl: string,
 * sonaEnabled: boolean,
 * }} Sanitized configuration consumed by request handlers.
 */
function loadConfig() {
  return {
    mode: process.env.MYBRAIN_MODE ?? "memory",
    logLevel: process.env.MYBRAIN_LOG_LEVEL ?? "info",
    llmModel: process.env.MYBRAIN_LLM_MODEL ?? "qwen3.5:0.8b",
    dbUrl: process.env.MYBRAIN_DB_URL ?? "",
    llmUrl: process.env.MYBRAIN_LLM_URL ?? "",
    sonaEnabled: parseBoolean(process.env.RUVLLM_SONA_ENABLED, true),
  };
}

const config = loadConfig();

/**
 * Sends JSON responses with stable content-type and status handling.
 *
 * @param {http.ServerResponse} res Node response object.
 * @param {number} status HTTP status code.
 * @param {Record<string, unknown>} payload Response body.
 * @returns {void}
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/**
 * Handles known routes used by gateway probes and operator diagnostics.
 *
 * @param {http.IncomingMessage} req HTTP request.
 * @param {http.ServerResponse} res HTTP response.
 * @returns {void}
 */
function handleRequest(req, res) {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "GET" && url === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "my-brain-orchestrator",
      mode: config.mode,
      sonaEnabled: config.sonaEnabled,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && url === "/v1/status") {
    sendJson(res, 200, {
      service: "my-brain-orchestrator",
      mode: config.mode,
      llm: {
        model: config.llmModel,
        endpoint: config.mode === "full" ? config.llmUrl : null,
      },
      memory: {
        dbConfigured: config.dbUrl.length > 0,
      },
    });
    return;
  }

  sendJson(res, 404, {
    error: "not_found",
    message: "Route not implemented in bootstrap orchestrator",
  });
}

const server = http.createServer(handleRequest);
const port = Number(process.env.RUVECTOR_PORT ?? 8080);

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `[my-brain] orchestrator listening on :${port} mode=${config.mode} log=${config.logLevel}\n`,
  );
});
