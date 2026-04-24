import { test } from "node:test";
import assert from "node:assert/strict";
import { asTextResult, isEnvelope } from "../dist/mcp/result.js";

test("isEnvelope detects v2 envelope shape", () => {
  assert.equal(
    isEnvelope({
      success: true,
      summary: "ok",
      data: { x: 1 },
      synthesis: { status: "ok", model: "qwen3.5:0.8b", latency_ms: 10 },
    }),
    true,
  );
  assert.equal(isEnvelope({ success: false }), false);
});

test("asTextResult emits text+json parts for envelope payload", () => {
  const envelope = {
    success: true,
    summary: "two memories found",
    data: { results: [{ id: "m1" }] },
    synthesis: {
      status: "ok",
      model: "qwen3.5:0.8b",
      latency_ms: 120,
    },
  };

  const result = asTextResult(envelope);
  assert.equal(result.content.length, 2);
  assert.deepEqual(result.content[0], {
    type: "text",
    text: "two memories found",
  });
  assert.deepEqual(result.content[1], {
    type: "json",
    json: envelope,
  });
});

test("asTextResult falls back to JSON data text when envelope summary is empty", () => {
  const envelope = {
    success: true,
    summary: "",
    data: { results: [] },
    synthesis: {
      status: "fallback",
      model: "qwen3.5:0.8b",
      latency_ms: 0,
      error: "timeout",
    },
  };

  const result = asTextResult(envelope);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[0].text, JSON.stringify(envelope.data));
  assert.equal(result.content[1].type, "json");
});

test("asTextResult preserves legacy single text output for non-envelope payload", () => {
  const payload = { success: false, error: "unsupported_tool" };
  const result = asTextResult(payload);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /unsupported_tool/);
});
