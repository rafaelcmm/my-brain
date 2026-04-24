/**
 * HTTP response helpers for the orchestrator's JSON API.
 *
 * All responses carry `application/json; charset=utf-8` to prevent clients
 * from guessing the charset. The helpers are intentionally thin so callers
 * remain readable when building success/error shapes inline.
 */

import type http from "node:http";

/**
 * Writes a JSON response with the given status code and body.
 *
 * Sets Content-Type to `application/json; charset=utf-8` before writing so
 * clients never have to guess the charset. The body is serialized in one
 * synchronous call to avoid chunked transfer encoding on small payloads.
 *
 * @param res - Node.js ServerResponse to write into.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable response body.
 */
export function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
