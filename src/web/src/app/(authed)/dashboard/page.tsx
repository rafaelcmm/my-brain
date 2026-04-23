import { Suspense } from "react";
import { getAuthenticatedClient } from "@/lib/application/server-auth";

/**
 * Dashboard page - displays brain summary and recent memories.
 * Requires authenticated session.
 */
async function BrainSummary() {
  const client = await getAuthenticatedClient();
  if (!client) {
    return <div>Unauthorized</div>;
  }

  let summary:
    | {
        total_memories: number;
        by_scope: Record<string, number>;
        by_type: Record<string, number>;
      }
    | null = null;
  let errorMessage: string | null = null;

  try {
    summary = await client.getBrainSummary();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown error";
  }

  if (!summary) {
    return (
      <div className="bg-red-50 rounded-lg p-4">
        <p className="text-red-800">Failed to load brain summary: {errorMessage}</p>
      </div>
    );
  }

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
          {Object.keys(summary.by_scope || {}).length}
        </p>
      </div>
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900">Memory Types</h3>
        <p className="mt-2 text-3xl font-extrabold text-green-600">
          {Object.keys(summary.by_type || {}).length}
        </p>
      </div>
    </div>
  );
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
