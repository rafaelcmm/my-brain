"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Memory } from "@/lib/domain";
import { readCsrfTokenFromMeta } from "@/lib/application/csrf-client";

interface MemoriesListClientProps {
  memories: Memory[];
}

/**
 * Render-time group bucket for reducing list density without changing data model.
 */
interface MemoryGroup {
  key: string;
  label: string;
  memories: Memory[];
}

/**
 * Groups memories by type and scope so dense lists are easier to scan.
 */
function buildMemoryGroups(memories: Memory[]): MemoryGroup[] {
  const map = new Map<string, MemoryGroup>();

  for (const memory of memories) {
    const key = `${memory.scope}::${memory.type}`;
    const existing = map.get(key);
    if (existing) {
      existing.memories.push(memory);
      continue;
    }

    map.set(key, {
      key,
      label: `${memory.scope} · ${memory.type}`,
      memories: [memory],
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

/**
 * Client-side selection and bulk-forget controls for memories list page.
 */
export function MemoriesListClient({ memories }: MemoriesListClientProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

  const memoryGroups = useMemo(() => buildMemoryGroups(memories), [memories]);

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected],
  );

  /**
   * Sends forget requests concurrently, then reports aggregate failures so one bad id
   * does not block cleanup of the remaining selected memories.
   */
  async function forgetSelected(): Promise<void> {
    if (selectedIds.length === 0) {
      return;
    }

    setBusy(true);
    setStatus(null);

    // Fire all forget requests concurrently so UI doesn't block per item.
    const csrfToken = readCsrfTokenFromMeta();
    const results = await Promise.allSettled(
      selectedIds.map((id) =>
        fetch("/api/memory/forget", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ id }),
        }).then(async (res) => {
          const payload = (await res.json()) as {
            error?: string;
            summary?: string;
          };
          if (!res.ok) {
            throw new Error(payload.error ?? "Failed to forget memory");
          }

          return payload.summary ?? "";
        }),
      ),
    );

    const failures = results.filter((r) => r.status === "rejected");

    if (failures.length > 0) {
      const messages = failures.map((r) =>
        r.status === "rejected" && r.reason instanceof Error
          ? r.reason.message
          : "Unknown error",
      );
      setStatus(`${failures.length} failed: ${messages.join("; ")}`);
    } else {
      const summaries = results
        .filter(
          (result): result is PromiseFulfilledResult<string> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value)
        .filter(Boolean);
      setStatus(
        summaries[0] || `${selectedIds.length} memories forgotten.`,
      );
    }

    setBusy(false);
    // Refresh server component data without full page reload.
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {selectedIds.length} selected · {memoryGroups.length} groups
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExpandedGroups(() => {
                const next: Record<string, boolean> = {};
                for (const group of memoryGroups) {
                  next[group.key] = true;
                }
                return next;
              });
            }}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => {
              setExpandedGroups({});
            }}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={forgetSelected}
            disabled={busy || selectedIds.length === 0}
            className="bg-red-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Forgetting..." : "Forget selected"}
          </button>
        </div>
      </div>

      {status ? <p className="text-sm text-gray-700">{status}</p> : null}

      <div className="bg-white rounded-lg shadow divide-y">
        {memories.length === 0 && (
          <div className="p-4 text-gray-600">No memories found.</div>
        )}
        {memoryGroups.map((group) => {
          const isCollapsed = !Boolean(expandedGroups[group.key]);
          return (
            <section key={group.key}>
              <button
                type="button"
                className="w-full px-4 py-3 flex items-center justify-between bg-gray-50"
                onClick={() => {
                  setExpandedGroups((current) => ({
                    ...current,
                    [group.key]: isCollapsed,
                  }));
                }}
              >
                <span className="text-xs uppercase tracking-wide text-gray-600">
                  {group.label}
                </span>
                <span className="text-xs text-gray-500">
                  {group.memories.length} {group.memories.length === 1 ? "item" : "items"} · {isCollapsed ? "collapsed" : "expanded"}
                </span>
              </button>

              {!isCollapsed
                ? group.memories.map((memory) => (
                    <article key={memory.id} className="p-4 border-t border-gray-100">
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
                          <a
                            href={`/memories/${encodeURIComponent(memory.id)}`}
                            className="text-sm ds-link-primary"
                          >
                            Open
                          </a>
                          <span className="text-xs text-gray-500">
                            {memory.created_at}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-gray-900 whitespace-pre-wrap">
                        {memory.content}
                      </p>
                    </article>
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
