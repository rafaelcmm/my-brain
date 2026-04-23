"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { readCsrfTokenFromMeta } from "@/lib/application/csrf-client";

/**
 * Query runner for recall and digest endpoints.
 */
export default function QueryPage() {
  const [tool, setTool] = useState<"recall" | "digest">("recall");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<string>("");
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
        body: JSON.stringify({ tool, query }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      setResult(JSON.stringify(payload, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900">Query Runner</h1>

        <form onSubmit={run} className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select value={tool} onChange={(event) => setTool(event.target.value as "recall" | "digest")} className="border rounded px-3 py-2">
              <option value="recall">recall</option>
              <option value="digest">digest</option>
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Recall query"
              className="border rounded px-3 py-2 md:col-span-3"
              disabled={tool === "digest"}
            />
          </div>

          <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50" disabled={loading}>
            {loading ? "Running..." : "Run"}
          </button>
        </form>

        <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-auto min-h-64">{result || "No result yet."}</pre>
      </div>
    </main>
  );
}
