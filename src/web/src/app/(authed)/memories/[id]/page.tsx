import { notFound } from "next/navigation";
import type { Memory } from "@/lib/domain";
import { getAuthenticatedClient } from "@/lib/composition/auth";
import { renderMarkdownToHtml } from "@/lib/application/render-markdown";
import { Breadcrumbs } from "@/app/(authed)/breadcrumbs";
import { MemoryContentToggle } from "@/app/(authed)/memories/[id]/memory-content-toggle";
import type { Metadata } from "next";

/** System metadata key prefix — rendered in a dedicated section. */
const SYS_PREFIX = "sys.";

export const metadata: Metadata = {
  title: "Memory Detail",
};

/**
 * Produces compact id labels so breadcrumb and heading remain readable.
 */
function toMemoryLabel(id: string): string {
  if (id.length <= 22) {
    return id;
  }

  return `${id.slice(0, 10)}...${id.slice(-8)}`;
}

/** Converts metadata keys into human-readable labels. */
function toMetadataLabel(key: string): string {
  return key
    .replace(/^sys\./, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Returns compact and expanded metadata strings to keep very large payloads readable.
 */
function toMetadataDisplay(
  key: string,
  value: unknown,
): { compact: string; expanded?: string } {
  if (key === "embedding") {
    if (Array.isArray(value)) {
      const preview = value.slice(0, 8).map((item) => Number(item).toFixed(4));
      return {
        compact: `${value.length} dimensions`,
        expanded: `[${preview.join(", ")}${value.length > 8 ? ", ..." : ""}]`,
      };
    }

    if (typeof value === "string") {
      return {
        compact: `Embedding payload (${value.length} chars)`,
        expanded: value,
      };
    }
  }

  if (Array.isArray(value)) {
    return {
      compact: `${value.length} items`,
      expanded: JSON.stringify(value, null, 2),
    };
  }

  if (value && typeof value === "object") {
    return {
      compact: "Object",
      expanded: JSON.stringify(value, null, 2),
    };
  }

  return { compact: String(value ?? "") };
}

/**
 * Memory detail page for a single memory id.
 * Uses the typed Memory domain aggregate returned by getMemory.
 */
export default async function MemoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const client = await getAuthenticatedClient();
  if (!client) {
    notFound();
  }

  const memory: Memory | null = await client.getMemory(resolvedParams.id);
  if (!memory) {
    notFound();
  }

  const renderedMarkdown = await renderMarkdownToHtml(memory.content);

  const sysEntries = Object.entries(memory.metadata ?? {}).filter(([k]) =>
    k.startsWith(SYS_PREFIX),
  );
  const userEntries = Object.entries(memory.metadata ?? {}).filter(
    ([k]) => !k.startsWith(SYS_PREFIX),
  );
  const memoryLabel = toMemoryLabel(memory.id);

  return (
    <main className="ds-page-shell px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Memories", href: "/memories" },
            { label: memoryLabel },
          ]}
        />

        <div className="ds-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase text-slate-500">
              {memory.type} · {memory.scope}
            </span>
            <span className="text-xs text-slate-500">
              {memory.created_at ?? ""}
            </span>
          </div>

          <h1 className="text-xl font-bold text-slate-900 break-all">
            {memory.id}
          </h1>
          <MemoryContentToggle
            renderedMarkdown={renderedMarkdown}
            rawContent={memory.content}
          />
        </div>

        {(sysEntries.length > 0 || userEntries.length > 0) && (
          <div className="ds-card space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Metadata</h2>

            {userEntries.length > 0 && (
              <MetadataSection title="Properties" entries={userEntries} />
            )}

            {sysEntries.length > 0 && (
              <MetadataSection title="System" entries={sysEntries} muted />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/** Renders a labeled group of metadata key/value pairs. */
function MetadataSection({
  title,
  entries,
  muted = false,
}: {
  title: string;
  entries: [string, unknown][];
  muted?: boolean;
}) {
  return (
    <section>
      <h3
        className={`text-xs font-semibold uppercase mb-2 ${muted ? "text-gray-400" : "text-gray-600"}`}
      >
        {title}
      </h3>
      <dl className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden bg-white">
        {entries.map(([key, value]) => {
          const display = toMetadataDisplay(key, value);

          return (
            <div
              key={key}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 px-3 py-3"
            >
              <dt className="md:col-span-4 min-w-0">
                <p
                  className={`text-[11px] font-semibold uppercase tracking-wide ${muted ? "text-gray-400" : "text-gray-500"}`}
                >
                  {toMetadataLabel(key)}
                </p>
                <p
                  className={`text-[11px] font-mono mt-1 break-all ${muted ? "text-gray-400" : "text-gray-500"}`}
                >
                  {key}
                </p>
              </dt>
              <dd className="md:col-span-8 min-w-0 text-xs text-gray-900 break-words">
                {display.expanded ? (
                  <details className="group">
                    <summary className="cursor-pointer list-none inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <span>{display.compact}</span>
                      <span className="text-[11px] text-slate-500 group-open:hidden">
                        Show details
                      </span>
                      <span className="text-[11px] text-slate-500 hidden group-open:inline">
                        Hide details
                      </span>
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-800">
                      {display.expanded}
                    </pre>
                  </details>
                ) : (
                  <span className="whitespace-pre-wrap break-all">
                    {display.compact}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
