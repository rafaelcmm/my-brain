import type { GraphSnapshot } from "@/lib/domain";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";

/**
 * Fetches graph snapshot used by the graph workspace.
 */
export class GetMemoryGraphUseCase {
  constructor(private readonly client: OrchestratorClient) {}

  /**
   * Returns graph snapshot with caller-provided sizing limits.
   */
  async execute(limit = 500, minSimilarity = 0.85): Promise<GraphSnapshot> {
    return this.client.getMemoryGraph(limit, minSimilarity);
  }
}
