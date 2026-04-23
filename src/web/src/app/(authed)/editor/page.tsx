"use client";

import type { FormEvent } from "react";
import { useState } from "react";

/**
 * Manual memory capture page.
 */
export default function EditorPage() {
  const [content, setContent] = useState("");
  const [type, setType] = useState("decision");
  const [scope, setScope] = useState("repo");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const response = await fetch("/api/memory/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type, scope, metadata: {} }),
      });

      const payload = (await response.json()) as { success: boolean; error?: string };
      if (!payload.success) {
        setStatus(payload.error ?? "Failed to save memory");
      } else {
        setStatus("Memory saved.");
        setContent("");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save memory");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900">New Memory</h1>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="w-full min-h-56 border rounded p-3"
            placeholder="Write durable memory content..."
            required
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select value={type} onChange={(event) => setType(event.target.value)} className="border rounded px-3 py-2">
              <option value="decision">decision</option>
              <option value="fix">fix</option>
              <option value="convention">convention</option>
              <option value="gotcha">gotcha</option>
              <option value="tradeoff">tradeoff</option>
              <option value="pattern">pattern</option>
              <option value="reference">reference</option>
            </select>

            <select value={scope} onChange={(event) => setScope(event.target.value)} className="border rounded px-3 py-2">
              <option value="repo">repo</option>
              <option value="project">project</option>
              <option value="global">global</option>
            </select>
          </div>

          <button disabled={loading} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50" type="submit">
            {loading ? "Saving..." : "Save memory"}
          </button>

          {status && <p className="text-sm text-gray-700">{status}</p>}
        </form>
      </div>
    </main>
  );
}
