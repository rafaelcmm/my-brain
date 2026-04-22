import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeTags,
  sanitizeText,
  validateMemoryEnvelope,
} from "../../src/domain/memory-validation.js";

test("sanitizeText trims and bounds values", () => {
  assert.equal(sanitizeText("  value  ", 10), "value");
  assert.equal(sanitizeText("", 10), null);
  assert.equal(sanitizeText(12, 10), null);
  assert.equal(sanitizeText("abcdefghijkl", 5), "abcde");
});

test("sanitizeTags keeps unique valid tags only", () => {
  assert.deepEqual(sanitizeTags(["Alpha", "alpha", "bad tag", "ok-1"]), [
    "alpha",
    "ok-1",
  ]);
});

test("validateMemoryEnvelope normalizes valid payloads", () => {
  const result = validateMemoryEnvelope({
    content: "Remember this",
    type: "decision",
    scope: "repo",
    metadata: {
      visibility: "team",
      tags: ["Memory", "memory", "ops"],
      frameworks: ["TypeScript", " Node ", 1],
      confidence: 0.8,
    },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.envelope?.metadata.tags, ["memory", "ops"]);
  assert.deepEqual(result.envelope?.metadata.frameworks, [
    "typescript",
    "node",
  ]);
  assert.equal(result.envelope?.metadata.visibility, "team");
});

test("validateMemoryEnvelope reports contract violations", () => {
  const result = validateMemoryEnvelope({
    content: "",
    type: "bad",
    scope: "everywhere",
    metadata: { confidence: 2 },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 4);
});
