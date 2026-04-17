import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { QueryUseCase } from '../../../core/application/use-cases/query-use-case.js';
import type { FeedbackUseCase } from '../../../core/application/use-cases/feedback-use-case.js';
import type { LearnUseCase } from '../../../core/application/use-cases/learn-use-case.js';

/**
 * McpBrainServer exposes application use-cases as MCP tools.
 */
export class McpBrainServer {
  private readonly server: McpServer;

  /**
   * @param name Server name reported to MCP clients.
   * @param version Server version reported to MCP clients.
   * @param queryUseCase Query application use-case.
   * @param feedbackUseCase Feedback application use-case.
   * @param learnUseCase Learn application use-case.
   */
  public constructor(
    name: string,
    version: string,
    private readonly queryUseCase: QueryUseCase,
    private readonly feedbackUseCase: FeedbackUseCase,
    private readonly learnUseCase: LearnUseCase,
  ) {
    this.server = new McpServer({ name, version });
    this.registerTools();
  }

  /**
   * Starts stdio transport for local MCP process integration.
   */
  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Executes query tool logic without transport layer.
   *
   * This hook exists to enable integration tests against tool behavior without
   * spinning up a full MCP client/server transport.
   */
  public async executeQueryTool(text: string, topK: number): Promise<Record<string, unknown>> {
    const result = await this.queryUseCase.execute({ text, topK });
    return { ...result } as Record<string, unknown>;
  }

  /**
   * Executes feedback tool logic without transport layer.
   */
  public async executeFeedbackTool(
    interactionId: string,
    qualityScore: number,
    route: string | undefined,
    forceLearnAfterFeedback: boolean,
  ): Promise<Record<string, unknown>> {
    const result = await this.feedbackUseCase.execute({
      interactionId,
      qualityScore,
      route,
      forceLearnAfterFeedback,
    });

    return { ...result } as Record<string, unknown>;
  }

  /**
   * Executes learn tool logic without transport layer.
   */
  public async executeLearnTool(): Promise<Record<string, unknown>> {
    const result = await this.learnUseCase.execute();
    return { ...result } as Record<string, unknown>;
  }

  /**
   * Registers query, feedback, and learn tools with strict schemas.
   */
  private registerTools(): void {
    this.server.registerTool(
      'query',
      {
        description:
          'Embed query with all-MiniLM, apply SONA instant learning, return interaction ID + patterns.',
        inputSchema: {
          text: z.string().min(1).max(10_000),
          topK: z.number().int().min(1).max(20).default(5),
        },
      },
      async ({ text, topK }) => {
        const result = await this.executeQueryTool(text, topK);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      },
    );

    this.server.registerTool(
      'feedback',
      {
        description:
          'Attach quality signal to prior interaction and optionally trigger immediate learning.',
        inputSchema: {
          interactionId: z.string().uuid(),
          qualityScore: z.number().min(0).max(1),
          route: z.string().max(100).optional(),
          forceLearnAfterFeedback: z.boolean().default(false),
        },
      },
      async ({ interactionId, qualityScore, route, forceLearnAfterFeedback }) => {
        const result = await this.executeFeedbackTool(
          interactionId,
          qualityScore,
          route,
          forceLearnAfterFeedback,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      },
    );

    this.server.registerTool(
      'learn',
      {
        description: 'Force SONA background learning cycle and return latest stats.',
      },
      async () => {
        const result = await this.executeLearnTool();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      },
    );
  }
}
