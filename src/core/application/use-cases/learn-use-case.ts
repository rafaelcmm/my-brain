import type { AdaptiveBrainPort } from '../../ports/adaptive-brain-port.js';
import type { LearnOutput } from '../dto/learn-dto.js';

/**
 * LearnUseCase triggers explicit consolidation cycle for operators or automations.
 */
export class LearnUseCase {
  /**
   * @param adaptiveBrainPort Outbound learning/storage dependency.
   */
  public constructor(private readonly adaptiveBrainPort: AdaptiveBrainPort) {}

  /**
   * Forces learning cycle and returns resulting status + stats.
   */
  public async execute(): Promise<LearnOutput> {
    const status = await this.adaptiveBrainPort.forceLearn();
    const stats = await this.adaptiveBrainPort.getStats();

    return {
      status,
      stats,
    };
  }
}
