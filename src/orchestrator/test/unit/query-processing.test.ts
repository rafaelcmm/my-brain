/**
 * Unit tests for processed recall query rewriting transport.
 *
 * These tests pin timeout and response-shape behavior so processed recall
 * does not regress to opaque 500s during cold model starts.
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  processRecallQuery,
  synthesizeRecallAnswer,
} from "../../src/infrastructure/query-processing.js";

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("processRecallQuery", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await closeServer(server);
      }
    }
  });

  it("returns rewritten query when LLM responds with response field", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: "  refined   recall  query  " }));
    });
    servers.push(server);

    const result = await processRecallQuery({
      llmUrl: url,
      model: "qwen3.5:0.8b",
      query: "why filters fail",
      timeoutMs: 500,
    });

    assert.equal(result.originalQuery, "why filters fail");
    assert.equal(result.processedQuery, "refined recall query");
    assert.equal(result.model, "qwen3.5:0.8b");
    assert.ok(result.latencyMs >= 0);
  });

  it("times out when LLM is slow", async () => {
    const { server, url } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ response: "late response" }));
      }, 1300);
    });
    servers.push(server);

    await assert.rejects(
      processRecallQuery({
        llmUrl: url,
        model: "qwen3.5:0.8b",
        query: "cold start",
        timeoutMs: 1000,
      }),
      /query processing timed out after 1000ms/,
    );
  });

  it("synthesizes grounded answer and sends think:false", async () => {
    let lastBody: Record<string, unknown> | null = null;
    const { server, url } = await startServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        lastBody = JSON.parse(raw) as Record<string, unknown>;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            response: "Use create-next-app with pnpm. [mem-1]",
          }),
        );
      });
    });
    servers.push(server);

    const synthesized = await synthesizeRecallAnswer({
      llmUrl: url,
      model: "qwen3.5:0.8b",
      question: "Best way to create Next.js app?",
      results: [
        {
          id: "mem-1",
          content: "Use pnpm create next-app@latest my-app --yes",
          score: 0.9,
        },
      ],
      timeoutMs: 1000,
    });

    assert.equal(synthesized.answer, "Use create-next-app with pnpm. [mem-1]");
    assert.equal(lastBody?.["think"], false);
  });
});
