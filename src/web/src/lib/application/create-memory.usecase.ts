import { z } from "zod";
import type { OrchestratorClient } from "@/lib/ports/orchestrator-client.port";

const createMemorySchema = z.object({
  content: z.string().min(1),
  type: z.string().min(1),
  scope: z.string().min(1),
  metadata: z.record(z.unknown()),
});

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

/**
 * Validates and executes memory creation through orchestrator port.
 */
export class CreateMemoryUseCase {
  constructor(private readonly client: OrchestratorClient) {}

  /**
   * Create memory after validating required fields and metadata envelope.
   */
  async execute(input: CreateMemoryInput): Promise<unknown> {
    const validated = createMemorySchema.parse(input);
    return this.client.createMemory(
      validated.content,
      validated.type,
      validated.scope,
      validated.metadata,
    );
  }
}
