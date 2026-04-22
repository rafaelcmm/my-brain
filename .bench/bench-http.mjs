#!/usr/bin/env node
/**
 * HTTP-level stress benchmark against a live orchestrator.
 *
 * Exercises the routes that don't require the intelligence engine
 * (digest, capabilities, context probe, session open/close, metrics,
 * vote, forget). The memory corpus must already be seeded by
 * bench-core.mjs — this script does NOT seed.
 */
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8090";
const TOKEN = readFileSync("/tmp/mb-stress/auth-token", "utf8").trim();
const INTERNAL_KEY = process.env.INTERNAL_KEY ?? "stress-internal-key-abc";
const QUERIES = parseInt(process.env.QUERIES ?? "400", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "16", 10);

const baseHeaders = {
  "content-type": "application/json",
  "x-mybrain-auth-token": TOKEN,
  "x-mybrain-internal-key": INTERNAL_KEY,
};

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
 * Executes load against one HTTP route and prints aggregated statistics.
 *
 * @param label Human-readable route label used in output.
 * @param build Callback that builds request payload from iteration index.
 * @param count Total requests to execute.
 * @param concurrency Number of parallel async workers.
 */
async function driveRoute(label, build, count, concurrency) {
  const latencies = [];
  const statuses = new Map();
  let cursor = 0;
  const workers = [];
  const started = performance.now();
  for (let w = 0; w < concurrency; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          // Shared cursor is safe in JS event loop and keeps workers balanced
          // without coordination overhead.
          const k = cursor++;
          if (k >= count) return;
          const { path, method = "POST", body } = build(k);
          const t0 = performance.now();
          let status;
          try {
            const res = await fetch(`${BASE}${path}`, {
              method,
              headers: baseHeaders,
              body: body === undefined ? undefined : JSON.stringify(body),
            });
            status = res.status;
            await res.text();
          } catch (err) {
            status = `err:${err.code ?? err.message}`;
          }
          latencies.push(performance.now() - t0);
          statuses.set(status, (statuses.get(status) ?? 0) + 1);
        }
      })(),
    );
  }
  await Promise.all(workers);
  const wallMs = performance.now() - started;
  const sum = latencies.reduce((a, b) => a + b, 0);
  const rps = (latencies.length / wallMs) * 1000;
  const distribution = [...statuses.entries()]
    .map(([s, n]) => `${s}=${n}`)
    .join(",");
  console.log(
    `${label.padEnd(22)} n=${String(latencies.length).padStart(4)} ` +
      `rps=${rps.toFixed(1).padStart(7)} ` +
      `avg=${(sum / latencies.length).toFixed(2).padStart(6)}ms ` +
      `p50=${pct(latencies, 50).toFixed(2).padStart(6)}ms ` +
      `p95=${pct(latencies, 95).toFixed(2).padStart(6)}ms ` +
      `p99=${pct(latencies, 99).toFixed(2).padStart(6)}ms ` +
      `max=${Math.max(...latencies)
        .toFixed(2)
        .padStart(6)}ms [${distribution}]`,
  );
}

/**
 * Runs full HTTP benchmark suite against currently running orchestrator.
 */
async function main() {
  console.log(
    `\n== mb-stress http ==  base=${BASE} queries=${QUERIES} concurrency=${CONCURRENCY}\n`,
  );

  await driveRoute(
    "capabilities GET",
    () => ({ path: "/v1/capabilities", method: "GET" }),
    QUERIES,
    CONCURRENCY,
  );

  await driveRoute(
    "metrics GET",
    () => ({ path: "/metrics", method: "GET" }),
    QUERIES,
    CONCURRENCY,
  );

  await driveRoute(
    "digest POST",
    () => ({
      path: "/v1/memory/digest",
      body: { since: "30d" },
    }),
    QUERIES,
    CONCURRENCY,
  );

  await driveRoute(
    "context.probe POST",
    () => ({
      path: "/v1/context/probe",
      body: { path: "/home/rafaelmonteiro/Workspace/my-brain" },
    }),
    Math.floor(QUERIES / 2),
    CONCURRENCY,
  );

  await driveRoute(
    "session.open POST",
    (k) => ({
      path: "/v1/session/open",
      body: { repo: "github.com/acme/api", agent: `bench-${k}` },
    }),
    100,
    8,
  );

  await driveRoute(
    "vote POST",
    (k) => ({
      path: "/v1/memory/vote",
      body: { memory_id: `bench-${k % 1000}`, vote: k % 2 === 0 ? 1 : -1 },
    }),
    QUERIES,
    CONCURRENCY,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
