/**
 * HTTP request body parsing utilities.
 *
 * Parsing reads the full stream, enforces a configurable byte limit, and
 * rejects payloads that are not JSON objects. Fails closed: any parse error
 * propagates as a rejected Promise so callers can return a 400 response.
 */

import type http from "node:http";

/**
 * Reads the request stream, enforces the byte cap, and parses as a JSON object.
 *
 * Rejects with a descriptive Error in the following cases:
 * - Total bytes exceed `maxBytes` (prevents memory exhaustion by large bodies)
 * - No data arrives within 30 seconds (guards against slow-loris stall)
 * - Body is not valid JSON
 * - Parsed JSON is not a plain object (array or primitive payloads are rejected)
 *
 * @param req - Incoming HTTP request stream.
 * @param maxBytes - Maximum accepted body size in bytes.
 * @returns Parsed JSON object from the request body.
 */
export function parseJsonBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    // Guard against slow-loris stall: destroy the socket after 30 seconds of inactivity.
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error("request timeout"));
    }, 30000);

    req.on("data", (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string);
      totalBytes += buffer.length;

      // Fail immediately when the cap is exceeded — don't buffer the full body.
      if (totalBytes > maxBytes) {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }

      chunks.push(buffer);
    });

    req.on("end", () => {
      clearTimeout(timeout);

      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!text) {
          resolve({});
          return;
        }

        const parsed: unknown = JSON.parse(text);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          reject(new Error("JSON body must be an object"));
          return;
        }

        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
