/**
 * Integration tests for Postgres-backed memory operations.
 *
 * Requires a live Postgres instance with the ruvector extension installed.
 * Use docker-compose.test.yml for isolated test runs:
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   TEST_DB_URL=postgres://mybrain_test:mybrain_test@localhost:5433/mybrain_test \
 *     pnpm --filter my-brain-orchestrator run test:integration
 *   docker compose -f docker-compose.test.yml down -v
 *
 * Tests are skipped automatically when TEST_DB_URL is not set, so the suite
 * can run in CI without requiring a database when only the unit gate is needed.
 *
 * Project rule: NO mocks. All assertions run against a real Postgres connection
 * so query semantics, index behavior, and trigger logic are actually exercised.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  createPool,
  initializeDatabase,
} from "../../src/infrastructure/postgres.js";
import {
  queryRecallCandidates,
  findDuplicateMemory,
  persistMemoryMetadata,
  loadVoteBias,
} from "../../src/infrastructure/postgres-memory.js";
import type { MemoryEnvelope } from "../../src/domain/types.js";

// ---------------------------------------------------------------------------
// Test guard — skip entire suite when no live DB is available.
// ---------------------------------------------------------------------------

const TEST_DB_URL = process.env["TEST_DB_URL"];

if (!TEST_DB_URL) {
  console.log(
    "[integration] Skipping postgres-memory suite — TEST_DB_URL not set.",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Minimal embedding vector used when no real provider is available. */
const FAKE_EMBEDDING = Array.from({ length: 1024 }, (_, i) =>
  i < 3 ? 1 / Math.sqrt(3) : 0,
);

/** Same vector slightly perturbed — used to test near-duplicate detection. */
const _NEAR_DUPLICATE_EMBEDDING = FAKE_EMBEDDING.map((v, i) =>
  i < 4 ? v * 0.9999 : v,
);

/**
 * Builds a minimal valid MemoryEnvelope for test purposes.
 *
 * @param overrides - Optional partial overrides applied to the envelope.
 * @returns MemoryEnvelope ready for persist/dedup operations.
 */
function makeEnvelope(overrides?: Partial<MemoryEnvelope>): MemoryEnvelope {
  return {
    content: "Integration test memory content",
    type: "decision",
    scope: "repo",
    metadata: {
      repo: "github.com/test/repo",
      repo_name: "test/repo",
      project: "test-project",
      language: "typescript",
      frameworks: ["node"],
      tags: ["integration", "test"],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

let pool: Pool;

before(async () => {
  pool = createPool(TEST_DB_URL!);
  const dbState = {
    connected: false,
    extensionVersion: null,
    adrSchemasReady: false,
    error: null,
  };
  // Integration setup must not throw on degraded warnings so test bootstrap can
  // expose root-cause context in CI logs before assertions fail.
  const pushDegraded = (reason: string): void => {
    console.warn(`[integration] degraded: ${reason}`);
  };
  const initialized = await initializeDatabase(
    { dbUrl: TEST_DB_URL!, embeddingDim: 1024 },
    dbState,
    pushDegraded,
  );
  assert.ok(
    initialized,
    "initializeDatabase must return a pool when DB is reachable",
  );
  pool = initialized;
  assert.ok(dbState.connected, "DB must connect before integration tests run");
  // Guard against false-green bootstrap where Postgres is reachable but the
  // ruvector extension did not activate.
  assert.ok(
    typeof dbState.extensionVersion === "string" &&
      dbState.extensionVersion.length > 0,
    "ruvector extension version must be detected during bootstrap",
  );

  // Purge any leftover rows from previous imperfect teardowns.
  await pool.query(
    "DELETE FROM my_brain_memory_metadata WHERE repo_name = 'test/repo'",
  );
});

after(async () => {
  // Clean up all rows written by this suite.
  await pool.query(
    "DELETE FROM my_brain_memory_metadata WHERE repo_name = 'test/repo'",
  );
  await pool.end();
});

// ---------------------------------------------------------------------------
// T2.1 — persistMemoryMetadata: basic upsert
// ---------------------------------------------------------------------------

describe("persistMemoryMetadata", () => {
  it("inserts a new metadata row and can be recalled", async () => {
    const memoryId = `test-persist-${Date.now()}`;
    const envelope = makeEnvelope({ content: "Upsert test content" });
    // Embed vector into metadata so persistMemoryMetadata can write it.
    (envelope.metadata as Record<string, unknown>)["embedding"] =
      FAKE_EMBEDDING;

    await persistMemoryMetadata(pool, memoryId, envelope);

    const candidates = await queryRecallCandidates(
      pool,
      { repo: "github.com/test/repo" },
      10,
    );
    const found = candidates.find((c) => String(c.memory_id) === memoryId);

    assert.ok(found, "persisted row must appear in recall candidates");
    assert.equal(String(found.content), "Upsert test content");
  });

  it("updates existing row on conflict (upsert semantics)", async () => {
    const memoryId = `test-upsert-${Date.now()}`;
    const first = makeEnvelope({ content: "First version" });
    (first.metadata as Record<string, unknown>)["embedding"] = FAKE_EMBEDDING;
    await persistMemoryMetadata(pool, memoryId, first);

    const second = makeEnvelope({ content: "Updated version" });
    (second.metadata as Record<string, unknown>)["embedding"] = FAKE_EMBEDDING;
    await persistMemoryMetadata(pool, memoryId, second);

    const candidates = await queryRecallCandidates(
      pool,
      { repo: "github.com/test/repo" },
      10,
    );
    const found = candidates.find((c) => String(c.memory_id) === memoryId);

    assert.ok(found, "upserted row must be findable");
    assert.equal(
      String(found.content),
      "Updated version",
      "content must reflect the update",
    );
  });
});

// ---------------------------------------------------------------------------
// T2.2 — queryRecallCandidates: scope and filter behavior
// ---------------------------------------------------------------------------

describe("queryRecallCandidates", () => {
  before(async () => {
    // Seed one global and one repo-scoped row.
    const globalRow = makeEnvelope({
      scope: "global",
      content: "Global memory",
    });
    (globalRow.metadata as Record<string, unknown>)["embedding"] =
      FAKE_EMBEDDING;

    const repoRow = makeEnvelope({ scope: "repo", content: "Repo memory" });
    (repoRow.metadata as Record<string, unknown>)["embedding"] = FAKE_EMBEDDING;

    await persistMemoryMetadata(
      pool,
      `test-scope-global-${Date.now()}`,
      globalRow,
    );
    await persistMemoryMetadata(pool, `test-scope-repo-${Date.now()}`, repoRow);
  });

  it("returns all non-expired rows when no filters are applied", async () => {
    const rows = await queryRecallCandidates(pool, {}, 100);
    assert.ok(rows.length > 0, "must return at least the seeded rows");
  });

  it("filters by scope correctly", async () => {
    const rows = await queryRecallCandidates(pool, { scope: "global" }, 100);
    for (const row of rows) {
      assert.equal(
        String(row.scope),
        "global",
        "all returned rows must be global scope",
      );
    }
  });

  it("filters by repo via normalizeRepoSelector", async () => {
    const rows = await queryRecallCandidates(
      pool,
      { repo: "github.com/test/repo" },
      100,
    );
    for (const row of rows) {
      const repoMatch =
        String(row.repo) === "github.com/test/repo" ||
        String(row.repo_name) === "test/repo";
      assert.ok(repoMatch, "repo filter must match by full repo or repo_name");
    }
  });

  it("respects forgotten_at exclusion by default", async () => {
    // Insert a forgotten row.
    const forgottenId = `test-forgotten-${Date.now()}`;
    const envelope = makeEnvelope({ content: "Forgotten memory" });
    (envelope.metadata as Record<string, unknown>)["embedding"] =
      FAKE_EMBEDDING;
    (envelope.metadata as Record<string, unknown>)["forgotten_at"] =
      new Date().toISOString();
    await persistMemoryMetadata(pool, forgottenId, envelope);

    const rows = await queryRecallCandidates(
      pool,
      { repo: "github.com/test/repo" },
      100,
    );
    const found = rows.find((r) => String(r.memory_id) === forgottenId);
    assert.equal(found, undefined, "forgotten row must be excluded by default");
  });

  it("includes forgotten rows when include_forgotten is true", async () => {
    const forgottenId = `test-forgotten-include-${Date.now()}`;
    const envelope = makeEnvelope({ content: "Forgettable memory" });
    (envelope.metadata as Record<string, unknown>)["embedding"] =
      FAKE_EMBEDDING;
    (envelope.metadata as Record<string, unknown>)["forgotten_at"] =
      new Date().toISOString();
    await persistMemoryMetadata(pool, forgottenId, envelope);

    const rows = await queryRecallCandidates(
      pool,
      { repo: "github.com/test/repo", include_forgotten: true },
      100,
    );
    const found = rows.find((r) => String(r.memory_id) === forgottenId);
    assert.ok(
      found,
      "forgotten row must appear when include_forgotten is true",
    );
  });
});

// ---------------------------------------------------------------------------
// T2.3 — findDuplicateMemory: fingerprint and semantic dedup
// ---------------------------------------------------------------------------

describe("findDuplicateMemory", () => {
  it("finds fingerprint duplicate for identical content", async () => {
    const existingId = `test-fingerprint-${Date.now()}`;
    const content = `Fingerprint dedup test content ${Date.now()}`;

    const existing = makeEnvelope({ content });
    (existing.metadata as Record<string, unknown>)["embedding"] =
      FAKE_EMBEDDING;
    await persistMemoryMetadata(pool, existingId, existing);

    // Submit same content — should trigger fingerprint match.
    const duplicate = makeEnvelope({ content });
    const result = await findDuplicateMemory(
      pool,
      duplicate,
      FAKE_EMBEDDING,
      true,
    );

    // Fingerprint match requires the same SHA-1 AND embedding similarity above threshold.
    // With identical embedding it should match — assert either fingerprint or semantic.
    assert.ok(result !== null, "duplicate must be detected");
    assert.equal(
      result.memoryId,
      existingId,
      "detected duplicate must point to the existing row",
    );
  });

  it("returns null for content with no existing match", async () => {
    const uniqueContent = `Unique content ${Date.now()} ${Math.random()}`;
    const uniqueEmbedding = Array.from({ length: 1024 }, () => Math.random());
    const envelope = makeEnvelope({ content: uniqueContent });

    const result = await findDuplicateMemory(
      pool,
      envelope,
      uniqueEmbedding,
      true,
    );

    assert.equal(result, null, "no duplicate must be found for unique content");
  });
});

// ---------------------------------------------------------------------------
// T2.4 — loadVoteBias: returns empty map for unknown IDs
// ---------------------------------------------------------------------------

describe("loadVoteBias", () => {
  it("returns empty map for unknown memory IDs", async () => {
    const result = await loadVoteBias(pool, ["non-existent-id-abc"]);
    assert.equal(result.size, 0, "unknown IDs must produce empty bias map");
  });

  it("returns empty map for empty input", async () => {
    const result = await loadVoteBias(pool, []);
    assert.equal(result.size, 0, "empty input must produce empty bias map");
  });
});
