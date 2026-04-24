import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createOllamaSynthesis } from "../../src/infrastructure/ollama-synthesis.js";

let server: Server | null = null;

afterEach(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  server = null;
});

async function startFakeServer(
  handler: (body: string, done: (status: number, payload: unknown) => void) => void,
): Promise<string> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      handler(body, (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
  });

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind fake synthesis server");
  }

  return `http://127.0.0.1:${address.port}`;
}

test("createOllamaSynthesis returns summary metadata on success", async () => {
  const llmUrl = await startFakeServer((_body, done) => {
    done(200, { response: "  concise summary output  " });
  });

  const synthesis = createOllamaSynthesis({
    llmUrl,
    model: "qwen3.5:0.8b",
    defaultTimeoutMs: 15_000,
  });

  const result = await synthesis.synthesize(
    "mb_digest",
    null,
    { rows: [{ count: 2 }] },
    15_000,
  );

  assert.equal(result.summary, "concise summary output");
  assert.equal(result.model, "qwen3.5:0.8b");
  assert.ok(result.latencyMs >= 0);
});

test("createOllamaSynthesis throws timeout error when server stalls", async () => {
  const llmUrl = await startFakeServer((_body, done) => {
    setTimeout(() => {
      done(200, { response: "late" });
    }, 1_200);
  });

  const synthesis = createOllamaSynthesis({
    llmUrl,
    model: "qwen3.5:0.8b",
    defaultTimeoutMs: 1_000,
  });

  await assert.rejects(
    () => synthesis.synthesize("mb_recall", "q", { results: [] }, 1_000),
    /timeout after/,
  );
});

test("createOllamaSynthesis throws on empty response", async () => {
  const llmUrl = await startFakeServer((_body, done) => {
    done(200, { response: "   " });
  });

  const synthesis = createOllamaSynthesis({
    llmUrl,
    model: "qwen3.5:0.8b",
    defaultTimeoutMs: 15_000,
  });

  await assert.rejects(
    () => synthesis.synthesize("mb_capabilities", null, { engine: true }, 15_000),
    /empty response/,
  );
});
