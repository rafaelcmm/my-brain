import { GetMemoryGraphUseCase } from "@/lib/application/get-memory-graph.usecase";
import { getAuthenticatedClient } from "@/lib/composition/auth";
import { GraphCanvasClient } from "@/app/(authed)/graph/graph-canvas-client";

/**
 * Graph page renders a lightweight node/edge snapshot for quick inspection.
 */
export default async function GraphPage() {
  const client = await getAuthenticatedClient();
  if (!client) {
    return <div className="p-6">Unauthorized</div>;
  }

  const useCase = new GetMemoryGraphUseCase(client);
  const graph = await useCase.execute(600, 0.85);

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900">Memory Graph</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Nodes</p>
            <p className="text-3xl font-extrabold text-blue-600">
              {graph.nodes.length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Edges</p>
            <p className="text-3xl font-extrabold text-green-600">
              {graph.edges.length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Total Memories</p>
            <p className="text-3xl font-extrabold text-gray-900">
              {graph.total_count}
            </p>
          </div>
        </div>

        <GraphCanvasClient graph={graph} />
      </div>
    </main>
  );
}
