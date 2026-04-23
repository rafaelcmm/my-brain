import { getAuthenticatedClient } from "@/lib/application/server-auth";

/**
 * Graph page renders a lightweight node/edge snapshot for quick inspection.
 */
export default async function GraphPage() {
  const client = await getAuthenticatedClient();
  if (!client) {
    return <div className="p-6">Unauthorized</div>;
  }

  const graph = await client.getMemoryGraph(120);

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900">Memory Graph</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Nodes</p>
            <p className="text-3xl font-extrabold text-blue-600">{graph.nodes.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Edges</p>
            <p className="text-3xl font-extrabold text-green-600">{graph.edges.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Total Memories</p>
            <p className="text-3xl font-extrabold text-gray-900">{graph.total_count}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow divide-y">
          {graph.nodes.slice(0, 20).map((node) => (
            <article key={node.id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase text-gray-500">{node.type}</span>
                <span className="text-xs text-gray-500">size {node.size}</span>
              </div>
              <p className="mt-2 text-gray-900">{node.label}</p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
