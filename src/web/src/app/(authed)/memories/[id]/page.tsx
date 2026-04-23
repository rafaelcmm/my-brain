import { notFound } from "next/navigation";
import Link from "next/link";
import { getAuthenticatedClient } from "@/lib/composition/auth";

/**
 * Memory detail page for a single memory id.
 */
export default async function MemoryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await getAuthenticatedClient();
  if (!client) {
    notFound();
  }

  const memory = await client.getMemory(params.id);
  if (!memory || typeof memory !== "object") {
    notFound();
  }

  const record = memory as Record<string, unknown>;
  const metadata =
    record.metadata && typeof record.metadata === "object"
      ? (record.metadata as Record<string, unknown>)
      : {};

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/memories" className="text-sm underline text-blue-700">
          Back to memories
        </Link>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase text-gray-500">
              {String(record.type ?? "unknown")} · {String(record.scope ?? "unknown")}
            </span>
            <span className="text-xs text-gray-500">{String(record.created_at ?? "")}</span>
          </div>

          <h1 className="text-xl font-bold text-gray-900">{String(record.id ?? params.id)}</h1>
          <p className="text-gray-900 whitespace-pre-wrap">{String(record.content ?? "")}</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Metadata</h2>
          <pre className="text-xs bg-gray-900 text-gray-100 rounded p-4 overflow-auto">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        </div>
      </div>
    </main>
  );
}
