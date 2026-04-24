import { notFound } from "next/navigation";
import Link from "next/link";
import type { Memory } from "@/lib/domain";
import { getAuthenticatedClient } from "@/lib/composition/auth";
import type { Metadata } from "next";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

/** System metadata key prefix — rendered in a dedicated section. */
const SYS_PREFIX = "sys.";

export const metadata: Metadata = {
  title: "Memory Detail",
};

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

  const renderedMarkdown = await renderMemoryMarkdown(memory.content);

  const sysEntries = Object.entries(memory.metadata ?? {}).filter(([k]) =>
    k.startsWith(SYS_PREFIX),
  );
  const userEntries = Object.entries(memory.metadata ?? {}).filter(
    ([k]) => !k.startsWith(SYS_PREFIX),
  );

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/memories" className="text-sm underline text-blue-700">
          Back to memories
        </Link>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase text-gray-500">
              {memory.type} · {memory.scope}
            </span>
            <span className="text-xs text-gray-500">
              {memory.created_at ?? ""}
            </span>
          </div>

          <h1 className="text-xl font-bold text-gray-900">{memory.id}</h1>
          <article
            className="prose prose-slate max-w-none text-gray-900"
            dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
          />
        </div>

        {(sysEntries.length > 0 || userEntries.length > 0) && (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Metadata</h2>

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

/**
 * Converts stored markdown into sanitized HTML for safe SSR rendering.
 */
async function renderMemoryMarkdown(content: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(content);

  return String(file);
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
      <dl className="divide-y divide-gray-100 border border-gray-100 rounded">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-5 gap-2 px-3 py-2">
            <dt
              className={`col-span-2 text-xs font-mono truncate ${muted ? "text-gray-400" : "text-gray-500"}`}
            >
              {key}
            </dt>
            <dd className="col-span-3 text-xs text-gray-900 break-words">
              {typeof value === "object"
                ? JSON.stringify(value)
                : String(value ?? "")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
