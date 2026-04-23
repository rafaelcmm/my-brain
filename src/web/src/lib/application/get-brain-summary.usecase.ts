import type { BrainSummary } from "@/lib/domain";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";

/**
 * Fetches summary payload used by dashboard cards.
 */
export class GetBrainSummaryUseCase {
  constructor(private readonly client: OrchestratorClient) {}

  async execute(): Promise<BrainSummary> {
    return this.client.getBrainSummary();
  }
}
