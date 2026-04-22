import test from "node:test";
import assert from "node:assert/strict";

import {
  lexicalBoost,
  similarity,
  voteBias,
} from "../../src/domain/scoring.js";

test("voteBias stays bounded and neutral without votes", () => {
  assert.equal(voteBias(0, 0), 0);
  assert.ok(voteBias(10, 0) <= 0.15);
  assert.ok(voteBias(0, 10) >= -0.15);
});

test("lexicalBoost rewards overlapping query tokens", () => {
  assert.equal(
    lexicalBoost("memory ranking", "vector memory ranking pipeline"),
    0.3,
  );
  assert.equal(lexicalBoost("xx", "vector memory ranking pipeline"), 0);
});

test("similarity handles equal, mismatched, and zero vectors", () => {
  assert.equal(similarity([1, 0], [1, 0]), 1);
  assert.equal(similarity([1, 0], [0, 1]), 0);
  assert.equal(similarity([1], [1, 0]), 0);
  assert.equal(similarity([0, 0], [0, 0]), 0);
});
