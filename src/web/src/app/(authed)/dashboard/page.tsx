import { Suspense } from "react";
import { cookies } from "next/headers";
import { env } from "@/lib/config/env";
import { HttpOrchestratorClient } from "@/lib/infrastructure/orchestrator/http-orchestrator-client";

/**
 * Dashboard page - displays brain summary and recent memories.
 * Requires authenticated session.
 */
async function BrainSummary() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    return <div>Unauthorized</div>;
  }

  try {
    const config = env();
    const client = new HttpOrchestratorClient(
      config.MYBRAIN_WEB_ORCHESTRATOR_URL,
      "", // bearer token not needed for internal endpoints
      config.MYBRAIN_INTERNAL_API_KEY,
    );

    const summary = await client.getBrainSummary();

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900">Total Memories</h3>
          <p className="mt-2 text-3xl font-extrabold text-blue-600">
            {summary.total_memories}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900">Scopes</h3>
          <p className="mt-2 text-2xl font-semibold text-gray-700">
            {Object.keys(summary.scope_stats || {}).length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900">Graph Nodes</h3>
          <p className="mt-2 text-3xl font-extrabold text-green-600">
            {summary.graph_node_count || 0}
          </p>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className="bg-red-50 rounded-lg p-4">
        <p className="text-red-800">
          Failed to load brain summary:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }
}

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-8">Dashboard</h1>

        <Suspense fallback={<div className="text-gray-600">Loading brain summary...</div>}>
          <BrainSummary />
        </Suspense>
      </div>
    </main>
  );
}
