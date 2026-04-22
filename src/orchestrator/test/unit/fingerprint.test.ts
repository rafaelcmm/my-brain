import test from "node:test";
import assert from "node:assert/strict";

import { asVector, contentFingerprint } from "../../src/domain/fingerprint.js";

test("contentFingerprint normalizes equivalent content", () => {
  assert.equal(
    contentFingerprint("  Hello\nWorld  "),
    contentFingerprint("hello world"),
  );
});

test("asVector coerces arrays and serialized arrays", () => {
  assert.deepEqual(asVector([1, "2", "bad", 3]), [1, 2, 3]);
  assert.deepEqual(asVector("[1,2,3]"), [1, 2, 3]);
  assert.equal(asVector("not-json"), null);
  assert.equal(asVector([]), null);
});
