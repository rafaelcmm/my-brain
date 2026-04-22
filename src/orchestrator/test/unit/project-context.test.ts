import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRepoSelector,
  parseRemoteRepo,
} from "../../src/domain/project-context.js";

test("normalizeRepoSelector expands remote variants", () => {
  assert.deepEqual(normalizeRepoSelector("git@github.com:owner/repo.git"), [
    "git@github.com:owner/repo.git",
    "github.com/owner/repo",
    "repo",
  ]);
  assert.deepEqual(normalizeRepoSelector(null), []);
});

test("parseRemoteRepo returns canonical repo identifiers", () => {
  assert.deepEqual(parseRemoteRepo("https://github.com/owner/repo.git"), {
    repo: "github.com/owner/repo",
    repo_name: "repo",
  });
  assert.deepEqual(parseRemoteRepo(undefined), {
    repo: null,
    repo_name: null,
  });
});
