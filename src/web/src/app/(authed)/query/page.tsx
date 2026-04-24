"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { readCsrfTokenFromMeta } from "@/lib/application/csrf-client";
import type { QueryTool } from "@/lib/domain";

interface QueryApiResponse {
  success: boolean;
  status: number;
  latency_ms: number;
  data: unknown;
  raw: Record<string, unknown>;
  error?: string;
}

function JsonTree({ value, label }: { value: unknown; label?: string }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-500">null</span>;
  }

  if (typeof value !== "object") {
    return <span className="text-gray-100">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <details className="ml-3" open={value.length <= 3}>
        <summary className="cursor-pointer text-gray-200">
          {label ?? "array"} [{value.length}]
        </summary>
        <div className="mt-1 space-y-1">
          {value.map((item, index) => (
            <JsonTree
              key={`${label ?? "item"}-${index}`}
              value={item}
              label={`[${index}]`}
            />
          ))}
        </div>
      </details>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <details className="ml-3" open={entries.length <= 4}>
      <summary className="cursor-pointer text-gray-200">
        {label ?? "object"}
      </summary>
      <div className="mt-1 space-y-1">
        {entries.map(([entryLabel, entryValue]) => (
          <JsonTree key={entryLabel} value={entryValue} label={entryLabel} />
        ))}
      </div>
    </details>
  );
}

/**
 * Query runner for recall and digest endpoints.
 */
export default function QueryPage() {
  const [tool, setTool] = useState<QueryTool>("mb_recall");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const [type, setType] = useState("");
  const [viewMode, setViewMode] = useState<"parsed" | "raw">("parsed");
  const [result, setResult] = useState<QueryApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/memory/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": readCsrfTokenFromMeta(),
        },
        body: JSON.stringify({
          tool,
          params: {
            query,
            scope,
            type,
          },
        }),
      });
      const payload = (await response.json()) as QueryApiResponse;
      setResult(payload);
    } catch (error) {
      setResult({
        success: false,
        status: 500,
        latency_ms: 0,
        data: null,
        raw: {},
        error: error instanceof Error ? error.message : "Query failed",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="ds-page-shell px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-slate-900">Query Runner</h1>

        <form
          onSubmit={run}
          className="ds-card p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <select
              value={tool}
              onChange={(event) => setTool(event.target.value as QueryTool)}
              className="ds-input"
            >
              <option value="mb_recall">mb_recall</option>
              <option value="mb_digest">mb_digest</option>
              <option value="mb_search">mb_search</option>
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Query"
              className="ds-input"
              disabled={tool === "mb_digest"}
            />
            <input
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              placeholder="Scope (optional)"
              className="ds-input"
            />
            <input
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="Type (digest only)"
              className="ds-input"
              disabled={tool !== "mb_digest"}
            />
          </div>

          <button
            type="submit"
            className="ds-btn-primary px-4 py-2 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Running..." : "Run"}
          </button>
        </form>

        <section className="bg-gray-900 text-gray-100 rounded-lg p-4 space-y-3 min-h-64">
          {!result ? <p>No result yet.</p> : null}
          {result ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded bg-gray-700 px-2 py-1">
                  status {result.status}
                </span>
                <span className="rounded bg-gray-700 px-2 py-1">
                  latency {result.latency_ms}ms
                </span>
                <span
                  className={`rounded px-2 py-1 ${result.success ? "bg-emerald-700" : "bg-red-700"}`}
                >
                  {result.success ? "success" : "error"}
                </span>
                {result.error ? (
                  <span className="text-red-300">{result.error}</span>
                ) : null}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("parsed")}
                  className={`rounded px-2 py-1 ${viewMode === "parsed" ? "bg-gray-100 text-gray-900" : "bg-gray-700 text-gray-100"}`}
                >
                  Parsed
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("raw")}
                  className={`rounded px-2 py-1 ${viewMode === "raw" ? "bg-gray-100 text-gray-900" : "bg-gray-700 text-gray-100"}`}
                >
                  Raw
                </button>
              </div>

              <div className="overflow-auto text-sm">
                {viewMode === "parsed" ? (
                  <JsonTree value={result.data} label="data" />
                ) : (
                  <pre>{JSON.stringify(result.raw, null, 2)}</pre>
                )}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
