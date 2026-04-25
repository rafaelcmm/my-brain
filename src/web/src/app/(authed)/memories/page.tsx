import { getAuthenticatedClient } from "@/lib/composition/auth";
import { MemoriesListClient } from "@/app/(authed)/memories/memories-list-client";
import { MemoriesPaginationControls } from "@/app/(authed)/memories/pagination-controls";
import { Breadcrumbs } from "@/app/(authed)/breadcrumbs";
import { renderMarkdownToHtml } from "@/lib/application/render-markdown";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Memories",
};

function buildNextPageUrl(
  nextCursor: string,
  searchParams?: {
    scope?: string;
    type?: string;
    language?: string;
    tag?: string;
    search?: string;
  },
): string {
  const params = new URLSearchParams();
  params.set("cursor", nextCursor);

  if (searchParams?.scope) params.set("scope", searchParams.scope);
  if (searchParams?.type) params.set("type", searchParams.type);
  if (searchParams?.language) params.set("language", searchParams.language);
  if (searchParams?.tag) params.set("tag", searchParams.tag);
  if (searchParams?.search) params.set("search", searchParams.search);

  return `?${params.toString()}`;
}

/**
 * Memories page with server-side filters and pagination cursor.
 *
 * In Next.js 15+, searchParams is a Promise and must be awaited before access.
 */
export default async function MemoriesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    scope?: string;
    type?: string;
    language?: string;
    tag?: string;
    search?: string;
    cursor?: string;
  }>;
}) {
  const client = await getAuthenticatedClient();
  if (!client) {
    return <div className="p-6">Unauthorized</div>;
  }

  // Await searchParams — required in Next.js 15+ where it is a Promise.
  const resolvedParams = await searchParams;

  const filters = {
    ...(resolvedParams?.scope ? { scope: resolvedParams.scope } : {}),
    ...(resolvedParams?.type ? { type: resolvedParams.type } : {}),
    ...(resolvedParams?.language ? { language: resolvedParams.language } : {}),
    ...(resolvedParams?.tag ? { tag: resolvedParams.tag } : {}),
    ...(resolvedParams?.search ? { search: resolvedParams.search } : {}),
  };

  const list = await client.listMemories(filters, resolvedParams?.cursor);
  const renderedMemories = await Promise.all(
    list.memories.map(async (memory) => ({
      ...memory,
      renderedContentHtml: await renderMarkdownToHtml(memory.content),
    })),
  );

  return (
    <main className="ds-page-shell px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Memories" },
          ]}
        />
        <h1 className="text-3xl font-extrabold text-slate-900">Memories</h1>

        <form className="grid grid-cols-1 md:grid-cols-5 gap-3 ds-card">
          <input
            name="search"
            placeholder="Search"
            defaultValue={resolvedParams?.search}
            className="ds-input"
          />
          <input
            name="scope"
            placeholder="Scope"
            defaultValue={resolvedParams?.scope}
            className="ds-input"
          />
          <input
            name="type"
            placeholder="Type"
            defaultValue={resolvedParams?.type}
            className="ds-input"
          />
          <input
            name="language"
            placeholder="Language"
            defaultValue={resolvedParams?.language}
            className="ds-input"
          />
          <button type="submit" className="ds-btn-primary px-3 py-2">
            Filter
          </button>
        </form>

        <MemoriesListClient memories={renderedMemories} />

        <MemoriesPaginationControls
          hasPrevious={Boolean(resolvedParams?.cursor)}
          nextPageUrl={
            list.next_cursor
              ? buildNextPageUrl(list.next_cursor, resolvedParams)
              : null
          }
        />
      </div>
    </main>
  );
}
