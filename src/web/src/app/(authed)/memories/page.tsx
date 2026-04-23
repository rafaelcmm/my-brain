import { getAuthenticatedClient } from "@/lib/composition/auth";

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
          <input name="search" placeholder="Search" defaultValue={searchParams?.search} className="border rounded px-3 py-2" />
          <input name="scope" placeholder="scope" defaultValue={searchParams?.scope} className="border rounded px-3 py-2" />
          <input name="type" placeholder="type" defaultValue={searchParams?.type} className="border rounded px-3 py-2" />
          <input name="language" placeholder="language" defaultValue={searchParams?.language} className="border rounded px-3 py-2" />
          <button type="submit" className="bg-blue-600 text-white rounded px-3 py-2">Filter</button>
        </form>

        <div className="bg-white rounded-lg shadow divide-y">
          {list.memories.length === 0 && (
            <div className="p-4 text-gray-600">No memories found.</div>
          )}
          {list.memories.map((memory) => (
            <article key={memory.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  {memory.type} · {memory.scope}
                </div>
                <div className="text-xs text-gray-500">{memory.created_at}</div>
              </div>
              <p className="mt-2 text-gray-900 whitespace-pre-wrap">{memory.content}</p>
            </article>
          ))}
        </div>

        {list.next_cursor && (
          <a
            className="inline-block bg-gray-900 text-white rounded px-4 py-2"
            href={`?cursor=${encodeURIComponent(list.next_cursor)}${searchParams?.scope ? `&scope=${encodeURIComponent(searchParams.scope)}` : ""}${searchParams?.type ? `&type=${encodeURIComponent(searchParams.type)}` : ""}${searchParams?.language ? `&language=${encodeURIComponent(searchParams.language)}` : ""}${searchParams?.search ? `&search=${encodeURIComponent(searchParams.search)}` : ""}`}
          >
            Next page
          </a>
        )}
      </div>
    </main>
  );
}
