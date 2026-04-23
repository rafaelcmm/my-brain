"use client";

import { useMemo, useState } from "react";
import type { Memory } from "@/lib/domain";
import { readCsrfTokenFromMeta } from "@/lib/application/csrf-client";

interface MemoriesListClientProps {
  memories: Memory[];
}

/**
 * Client-side selection and bulk-forget controls for memories list page.
 */
export function MemoriesListClient({ memories }: MemoriesListClientProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected],
  );

  async function forgetSelected(): Promise<void> {
    if (selectedIds.length === 0) {
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      for (const id of selectedIds) {
        const response = await fetch("/api/memory/forget", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": readCsrfTokenFromMeta(),
          },
          body: JSON.stringify({ id }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Failed to forget memory");
        }
      }

      setStatus(`${selectedIds.length} memories forgotten.`);
      window.location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to forget memory");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {selectedIds.length} selected
        </p>
        <button
          type="button"
          onClick={forgetSelected}
          disabled={busy || selectedIds.length === 0}
          className="bg-red-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
        >
          {busy ? "Forgetting..." : "Forget selected"}
        </button>
      </div>

      {status ? <p className="text-sm text-gray-700">{status}</p> : null}

      <div className="bg-white rounded-lg shadow divide-y">
        {memories.length === 0 && (
          <div className="p-4 text-gray-600">No memories found.</div>
        )}
        {memories.map((memory) => (
          <article key={memory.id} className="p-4">
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(selected[memory.id])}
                  onChange={(event) => {
                    setSelected((current) => ({
                      ...current,
                      [memory.id]: event.target.checked,
                    }));
                  }}
                />
                <span className="text-xs uppercase tracking-wide text-gray-500">
                  {memory.type} · {memory.scope}
                </span>
              </label>
              <div className="flex items-center gap-3">
                <a href={`/memories/${encodeURIComponent(memory.id)}`} className="text-sm underline text-blue-700">
                  Open
                </a>
                <span className="text-xs text-gray-500">{memory.created_at}</span>
              </div>
            </div>
            <p className="mt-2 text-gray-900 whitespace-pre-wrap">{memory.content}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
