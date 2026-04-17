import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { QueryUseCase } from '../../../core/application/use-cases/query-use-case.js';
import type { FeedbackUseCase } from '../../../core/application/use-cases/feedback-use-case.js';
import type { LearnUseCase } from '../../../core/application/use-cases/learn-use-case.js';

/**
 * HTTP transport hardening options passed from runtime configuration.
 */
export interface HttpSecurityOptions {
  /** Optional explicit CORS allow-list. Empty disables CORS headers. */
  readonly allowedOrigins: readonly string[];

  /** Maximum request body size accepted by MCP endpoint. */
  readonly maxBodyBytes: number;

  /** Time window in milliseconds used by rate limiter. */
  readonly rateLimitWindowMs: number;

  /** Maximum requests allowed in each rate-limit window. */
  readonly rateLimitMax: number;
}

/**
 * McpBrainServer exposes application use-cases as MCP tools.
 */
export class McpBrainServer {
  private readonly server: McpServer;
  private readonly httpTransport: StreamableHTTPServerTransport;

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
    private readonly httpSecurityOptions: HttpSecurityOptions,
  ) {
    this.server = new McpServer({ name, version });
    this.httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
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
   * Starts streamable HTTP MCP transport for local or cloud deployment.
   *
   * @param port TCP port to listen on.
   * @param host Interface binding host.
   */
  public async startHttp(port: number, host: string): Promise<void> {
    await this.server.connect(this.httpTransport);

    const app = createMcpExpressApp({ host });

    app.use(helmet());

    if (this.httpSecurityOptions.allowedOrigins.length > 0) {
      app.use(
        cors({
          origin: [...this.httpSecurityOptions.allowedOrigins],
          credentials: true,
        }),
      );
    }

    app.use('/mcp', (req: Request, res: Response, next: () => void) => {
      const contentLength = req.headers['content-length'];
      const bodySize =
        typeof contentLength === 'string' ? Number.parseInt(contentLength, 10) : Number.NaN;

      if (Number.isFinite(bodySize) && bodySize > this.httpSecurityOptions.maxBodyBytes) {
        res.status(413).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Request payload too large',
          },
          id: null,
        });
        return;
      }

      next();
    });

    app.use(
      '/mcp',
      rateLimit({
        windowMs: this.httpSecurityOptions.rateLimitWindowMs,
        max: this.httpSecurityOptions.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );

    app.post('/mcp', async (req: Request, res: Response) => {
      try {
        await this.httpTransport.handleRequest(req, res, req.body);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
        throw error;
      }
    });

    app.get('/mcp', async (req: Request, res: Response) => {
      await this.httpTransport.handleRequest(req, res);
    });

    app.delete('/mcp', async (req: Request, res: Response) => {
      await this.httpTransport.handleRequest(req, res);
    });

    app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'ok',
        transport: 'http',
      });
    });

    await new Promise<void>((resolve, reject) => {
      const httpServer = app.listen(port, host, () => resolve());
      httpServer.on('error', reject);
    });
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
