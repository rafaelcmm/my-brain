import { getAuthenticatedClient } from "@/lib/composition/auth";
import { MemoriesListClient } from "@/app/(authed)/memories/memories-list-client";
import { Breadcrumbs } from "@/app/(authed)/breadcrumbs";
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
            placeholder="scope"
            defaultValue={resolvedParams?.scope}
            className="ds-input"
          />
          <input
            name="type"
            placeholder="type"
            defaultValue={resolvedParams?.type}
            className="ds-input"
          />
          <input
            name="language"
            placeholder="language"
            defaultValue={resolvedParams?.language}
            className="ds-input"
          />
          <button type="submit" className="ds-btn-primary px-3 py-2">
            Filter
          </button>
        </form>

        <MemoriesListClient memories={list.memories} />

        {list.next_cursor && (
          <a
            className="inline-block ds-btn-primary px-4 py-2"
            href={buildNextPageUrl(list.next_cursor, resolvedParams)}
          >
            Next page
          </a>
        )}
      </div>
    </main>
  );
}
