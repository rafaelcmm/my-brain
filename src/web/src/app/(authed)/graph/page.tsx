import { GetMemoryGraphUseCase } from "@/lib/application/get-memory-graph.usecase";
import { getAuthenticatedClient } from "@/lib/composition/auth";
import { GraphCanvasClient } from "@/app/(authed)/graph/graph-canvas-client";
import { Breadcrumbs } from "@/app/(authed)/breadcrumbs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Memory Graph",
};

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
    <main className="ds-page-shell px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Graph" },
          ]}
        />
        <h1 className="text-3xl font-extrabold text-slate-900">Memory Graph</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start auto-rows-min">
          <div className="ds-card">
            <p className="ds-card-title">
              Nodes
            </p>
            <p className="ds-card-metric text-[#2E3192]">
              {graph.nodes.length}
            </p>
          </div>
          <div className="ds-card">
            <p className="ds-card-title">
              Edges
            </p>
            <p className="ds-card-metric text-[#00ADEF]">
              {graph.edges.length}
            </p>
          </div>
          <div className="ds-card ds-card-accent">
            <p className="ds-card-title">
              Total memories
            </p>
            <p className="ds-card-metric text-slate-900">
              {graph.total_count}
            </p>
          </div>
        </div>

        <GraphCanvasClient graph={graph} />
      </div>
    </main>
  );
}
