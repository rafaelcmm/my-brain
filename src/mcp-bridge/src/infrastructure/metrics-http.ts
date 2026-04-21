import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { BridgeConfig } from "../domain/types.js";
import type { BridgeMetrics } from "../domain/metrics.js";

/**
 * Compares shared secret values using constant-time semantics.
 *
 * @param provided Header-provided secret.
 * @param expected Configured secret.
 * @returns True when both secrets match exactly.
 */
function constantTimeEquals(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Starts optional metrics endpoint when configured port is positive.
 *
 * @param config Runtime bridge configuration.
 * @param metrics In-memory metrics store to render.
 */
export function startMetricsServer(config: BridgeConfig, metrics: BridgeMetrics): void {
  if (!Number.isFinite(config.metricsPort) || config.metricsPort <= 0) {
    return;
  }

  createServer((req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      const header = req.headers["x-mybrain-internal-key"];
      const provided = Array.isArray(header) ? header[0] : header;

      // Preserve original policy: empty configured key keeps endpoint closed.
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
      res.end(metrics.render());
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }).listen(config.metricsPort, "0.0.0.0", () => {
    process.stderr.write(`[my-brain] bridge metrics listening on :${config.metricsPort}\n`);
  });
}
