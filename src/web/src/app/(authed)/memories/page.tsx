import { getAuthenticatedClient } from "@/lib/composition/auth";
import { MemoriesListClient } from "@/app/(authed)/memories/memories-list-client";

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
 */
export default async function MemoriesPage({
  searchParams,
}: {
  searchParams?: {
    scope?: string;
    type?: string;
    language?: string;
    tag?: string;
    search?: string;
    cursor?: string;
  };
}) {
  const client = await getAuthenticatedClient();
  if (!client) {
    return <div className="p-6">Unauthorized</div>;
  }

  const filters = {
    ...(searchParams?.scope ? { scope: searchParams.scope } : {}),
    ...(searchParams?.type ? { type: searchParams.type } : {}),
    ...(searchParams?.language ? { language: searchParams.language } : {}),
    ...(searchParams?.tag ? { tag: searchParams.tag } : {}),
    ...(searchParams?.search ? { search: searchParams.search } : {}),
  };

  const list = await client.listMemories(filters, searchParams?.cursor);

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900">Memories</h1>

        <form className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white p-4 rounded-lg shadow">
          <input
            name="search"
            placeholder="Search"
            defaultValue={searchParams?.search}
            className="border rounded px-3 py-2"
          />
          <input
            name="scope"
            placeholder="scope"
            defaultValue={searchParams?.scope}
            className="border rounded px-3 py-2"
          />
          <input
            name="type"
            placeholder="type"
            defaultValue={searchParams?.type}
            className="border rounded px-3 py-2"
          />
          <input
            name="language"
            placeholder="language"
            defaultValue={searchParams?.language}
            className="border rounded px-3 py-2"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white rounded px-3 py-2"
          >
            Filter
          </button>
        </form>

        <MemoriesListClient memories={list.memories} />

        {list.next_cursor && (
          <a
            className="inline-block bg-gray-900 text-white rounded px-4 py-2"
            href={buildNextPageUrl(list.next_cursor, searchParams)}
          >
            Next page
          </a>
        )}
      </div>
    </main>
  );
}
