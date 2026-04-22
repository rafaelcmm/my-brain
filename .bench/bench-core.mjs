#!/usr/bin/env node
/**
 * Core DB + scoring pipeline throughput benchmark.
 *
 * Bypasses HTTP + intelligence engine to measure the pure orchestrator
 * query + scoring hot path against the real Postgres + ruvector backend.
 */
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const ORCH = "/home/rafaelmonteiro/Workspace/my-brain/src/orchestrator";
const require = createRequire(`${ORCH}/package.json`);
process.chdir(ORCH);

const { Pool } = require("pg");
const {
  persistMemoryMetadata,
  queryRecallCandidates,
  findDuplicateMemory,
  loadVoteBias,
} = await import(`${ORCH}/dist/infrastructure/postgres-memory.js`);
const { similarity, lexicalBoost } = await import(
  `${ORCH}/dist/domain/scoring.js`
);

const DIM = 1024;
const CORPUS_SIZE = parseInt(process.env.CORPUS_SIZE ?? "2000", 10);
const QUERIES = parseInt(process.env.QUERIES ?? "500", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "16", 10);

const pool = new Pool({
  connectionString:
    "postgres://mybrain_test:mybrain_test@localhost:5433/mybrain_test",
  max: 24,
});

/**
 * Generates random unit-length vector for similarity benchmarks.
 *
 * @param dim Target vector dimensionality.
 * @returns Normalized numeric vector.
 */
function randomUnitVector(dim) {
  const v = new Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    const x = Math.random() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  const s = 1 / Math.sqrt(norm || 1);
  for (let i = 0; i < dim; i += 1) v[i] *= s;
  return v;
}

/**
 * Returns requested percentile from numeric sample set.
 *
 * @param values Latency samples in milliseconds.
 * @param p Percentile from 0 to 100.
 * @returns Percentile value from sorted samples.
 */
function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx];
}

/**
 * Deletes previous benchmark rows to guarantee clean corpus sizing.
 */
async function clearCorpus() {
  await pool.query(
    "DELETE FROM my_brain_memory_metadata WHERE memory_id LIKE 'bench-%'",
  );
  await pool.query(
    "DELETE FROM my_brain_memory_votes WHERE memory_id LIKE 'bench-%'",
  );
}

/**
 * Seeds synthetic memory corpus in parallel workers.
 *
 * @param n Number of rows to insert.
 * @returns Wall-clock time spent seeding in milliseconds.
 */
async function seedCorpus(n) {
  const words = [
    "postgres",
    "typescript",
    "memory",
    "vector",
    "index",
    "recall",
    "embedding",
    "scope",
    "project",
    "fingerprint",
    "learning",
    "latency",
    "pool",
    "orchestrator",
    "mcp",
    "docker",
    "cache",
    "schema",
    "rate",
    "limit",
  ];
  const scopes = ["repo", "project", "global"];
  const types = [
    "decision",
    "fix",
    "convention",
    "gotcha",
    "tradeoff",
    "pattern",
    "reference",
  ];
  const repos = [
    "github.com/acme/api",
    "github.com/acme/web",
    "github.com/acme/infra",
  ];
  const languages = ["typescript", "go", "rust", "python"];
  const started = performance.now();
  const workers = [];
  const perWorker = Math.ceil(n / CONCURRENCY);
  for (let w = 0; w < CONCURRENCY; w += 1) {
    workers.push(
      (async () => {
        for (let i = 0; i < perWorker; i += 1) {
          const k = w * perWorker + i;
          if (k >= n) return;
          const tokens = Array.from(
            { length: 6 + (k % 6) },
            (_, j) => words[(k + j) % words.length],
          );
          const content = `bench ${k} ${tokens.join(" ")}`;
          const envelope = {
            content,
            type: types[k % types.length],
            scope: scopes[k % scopes.length],
            metadata: {
              repo: repos[k % repos.length],
              repo_name: repos[k % repos.length].split("/").pop(),
              project: "bench-project",
              language: languages[k % languages.length],
              frameworks: ["node"],
              path: null,
              symbol: null,
              tags: [tokens[0], tokens[1]],
              source: "bench",
              author: "bench-author",
              agent: "bench",
              created_at: null,
              expires_at: null,
              confidence: 0.8,
              visibility: "private",
              embedding: randomUnitVector(DIM),
            },
          };
          await persistMemoryMetadata(pool, `bench-${k}`, envelope);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return performance.now() - started;
}

/**
 * Benchmarks recall hot path (candidate query + vote load + scoring).
 *
 * @param count Number of recall operations.
 * @param concurrency Number of parallel async workers.
 * @returns Latency samples and wall-clock duration.
 */
async function benchRecall(count, concurrency) {
  const latencies = [];
  let cursor = 0;
  const workers = [];
  const started = performance.now();
  for (let w = 0; w < concurrency; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          // Shared cursor is safe here because JS event loop increments between
          // awaits; this provides low-overhead work-stealing across workers.
          const k = cursor++;
          if (k >= count) return;
          const t0 = performance.now();
          const queryEmbedding = randomUnitVector(DIM);
          const candidates = await queryRecallCandidates(
            pool,
            {
              scope: "repo",
              repo: "github.com/acme/api",
              include_expired: false,
              include_forgotten: false,
              include_redacted: false,
            },
            48,
            queryEmbedding,
          );
          const ids = candidates.map((c) => String(c.memory_id));
          const votes = ids.length ? await loadVoteBias(pool, ids) : new Map();
          for (const c of candidates) {
            const emb =
              typeof c.embedding === "string"
                ? JSON.parse(c.embedding)
                : Array.isArray(c.embedding)
                  ? c.embedding
                  : [];
            const s = similarity(queryEmbedding, emb);
            const lex = lexicalBoost(
              "vector recall postgres",
              typeof c.content === "string" ? c.content : "",
            );
            const v = votes.get(String(c.memory_id))?.bias ?? 0;
            void (s + lex + v);
          }
          latencies.push(performance.now() - t0);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return { latencies, wallMs: performance.now() - started };
}

/**
 * Benchmarks dedup hot path using mixed duplicate/unique requests.
 *
 * @param count Number of dedup checks.
 * @param concurrency Number of parallel async workers.
 * @returns Latency samples and wall-clock duration.
 */
async function benchDedupCheck(count, concurrency) {
  const latencies = [];
  let cursor = 0;
  const started = performance.now();
  const workers = [];
  for (let w = 0; w < concurrency; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          // Same shared-cursor pattern keeps worker load balanced without mutexes.
          const k = cursor++;
          if (k >= count) return;
          const existingIdx = k % CORPUS_SIZE;
          const content =
            k % 3 === 0
              ? `bench ${existingIdx} postgres typescript memory vector index recall`
              : `nobench ${k} unique random ${Math.random()}`;
          const envelope = {
            content,
            type: "decision",
            scope: "repo",
            metadata: {
              repo: "github.com/acme/api",
              repo_name: "api",
              project: "bench-project",
              language: "typescript",
              frameworks: ["node"],
              path: null,
              symbol: null,
              tags: ["postgres"],
              source: "bench",
              author: "bench",
              agent: "bench",
              created_at: null,
              expires_at: null,
              confidence: 1,
              visibility: "private",
            },
          };
          const t0 = performance.now();
          await findDuplicateMemory(
            pool,
            envelope,
            randomUnitVector(DIM),
            false,
          );
          latencies.push(performance.now() - t0);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return { latencies, wallMs: performance.now() - started };
}

/**
 * Prints summary row for one benchmark stage.
 *
 * @param label Stage label.
 * @param latencies Stage latency samples in milliseconds.
 * @param wallMs Total stage wall-clock duration in milliseconds.
 */
function report(label, latencies, wallMs) {
  const sum = latencies.reduce((a, b) => a + b, 0);
  const rps = (latencies.length / wallMs) * 1000;
  console.log(
    `${label.padEnd(18)} n=${String(latencies.length).padStart(5)} ` +
      `rps=${rps.toFixed(1).padStart(7)} ` +
      `avg=${(sum / latencies.length).toFixed(2).padStart(6)}ms ` +
      `p50=${pct(latencies, 50).toFixed(2).padStart(6)}ms ` +
      `p95=${pct(latencies, 95).toFixed(2).padStart(6)}ms ` +
      `p99=${pct(latencies, 99).toFixed(2).padStart(6)}ms ` +
      `max=${Math.max(...latencies)
        .toFixed(2)
        .padStart(6)}ms`,
  );
}

/**
 * Executes full core benchmark workflow and prints stage summaries.
 */
async function main() {
  console.log(
    `\n== mb-stress core ==  corpus=${CORPUS_SIZE} queries=${QUERIES} concurrency=${CONCURRENCY}\n`,
  );
  console.log("[1/4] purging prior bench corpus ...");
  await clearCorpus();
  console.log("[2/4] seeding corpus ...");
  const seedMs = await seedCorpus(CORPUS_SIZE);
  console.log(
    `      seeded ${CORPUS_SIZE} rows in ${seedMs.toFixed(0)}ms (${((CORPUS_SIZE / seedMs) * 1000).toFixed(1)} writes/sec)`,
  );
  console.log("[3/4] recall benchmark ...");
  const recall = await benchRecall(QUERIES, CONCURRENCY);
  report("recall-end-to-end", recall.latencies, recall.wallMs);
  console.log("[4/4] dedup benchmark ...");
  const dedup = await benchDedupCheck(QUERIES, CONCURRENCY);
  report("dedup-check", dedup.latencies, dedup.wallMs);
  const countRes = await pool.query(
    "SELECT count(*)::int AS n FROM my_brain_memory_metadata WHERE memory_id LIKE 'bench-%'",
  );
  console.log(`\ncorpus rows in DB: ${countRes.rows[0].n}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
