import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { QueryUseCase } from '../../../core/application/use-cases/query-use-case.js';
import type { FeedbackUseCase } from '../../../core/application/use-cases/feedback-use-case.js';
import type { InspectInteractionUseCase } from '../../../core/application/use-cases/inspect-interaction-use-case.js';
import type { LearnUseCase } from '../../../core/application/use-cases/learn-use-case.js';
import type { AuthTokenPort } from '../../../core/ports/auth-token-port.js';

/**
 * HTTP transport hardening options passed from runtime configuration.
 */
export interface HttpSecurityOptions {
  /** Persisted token verifier for HTTP MCP endpoint. */
  readonly authTokens?: AuthTokenPort;

  /** Optional seed token used when persisted store is still empty. */
  readonly bootstrapToken?: string;

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
  private readonly httpSessionsById = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  /**
   * @param name Server name reported to MCP clients.
   * @param version Server version reported to MCP clients.
   * @param queryUseCase Query application use-case.
   * @param inspectInteractionUseCase Interaction inspection use-case.
   * @param feedbackUseCase Feedback application use-case.
   * @param learnUseCase Learn application use-case.
   * @param httpSecurityOptions HTTP hardening contract, including optional bearer
   * token verifier, bootstrap seed for empty token stores, CORS allow-list,
   * request-size ceiling, and rate-limiting controls.
   */
  public constructor(
    private readonly name: string,
    private readonly version: string,
    private readonly queryUseCase: QueryUseCase,
    private readonly inspectInteractionUseCase: InspectInteractionUseCase,
    private readonly feedbackUseCase: FeedbackUseCase,
    private readonly learnUseCase: LearnUseCase,
    private readonly httpSecurityOptions: HttpSecurityOptions,
  ) {}

  /**
   * Starts stdio transport for local MCP process integration.
   */
  public async startStdio(): Promise<void> {
    const server = this.createProtocolServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  /**
   * Starts streamable HTTP MCP transport with auth, body-size, and rate-limit guards.
   *
   * @param port TCP port to listen on.
   * @param host Interface binding host.
   * @throws Error when auth token verifier is not configured for HTTP mode.
   * @throws Error when underlying HTTP server fails to bind.
   */
  public async startHttp(port: number, host: string): Promise<void> {
    const app = createMcpExpressApp({ host });
    if (!this.httpSecurityOptions.authTokens) {
      throw new Error('HTTP transport requires auth token verifier configuration.');
    }

    this.httpSecurityOptions.authTokens.ensureActiveToken(this.httpSecurityOptions.bootstrapToken);

    // Honor upstream proxy headers to make per-client rate limiting accurate behind reverse proxies.
    app.set('trust proxy', 1);

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

    app.use('/mcp', (req: Request, res: Response, next: () => void) => {
      const authTokens = this.httpSecurityOptions.authTokens;
      if (!authTokens) {
        next();
        return;
      }

      const providedToken = this.parseBearerToken(req.header('authorization'));
      const isTokenValid = authTokens.verifyToken(providedToken);

      if (!isTokenValid) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Unauthorized',
          },
          id: null,
        });
        return;
      }

      next();
    });

    app.post('/mcp', async (req: Request, res: Response) => {
      try {
        const sessionId = this.getSessionId(req);

        let transport: StreamableHTTPServerTransport | undefined;

        if (sessionId !== undefined) {
          transport = this.httpSessionsById.get(sessionId)?.transport;
          if (!transport) {
            res.status(400).json({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Bad Request: Invalid or unknown Mcp-Session-Id',
              },
              id: null,
            });
            return;
          }
        } else if (isInitializeRequest(req.body)) {
          transport = await this.createAndConnectHttpTransport();
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: Mcp-Session-Id header is required',
            },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
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
      const sessionId = this.getSessionId(req);
      if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Mcp-Session-Id header is required',
          },
          id: null,
        });
        return;
      }

      const transport = this.httpSessionsById.get(sessionId)?.transport;
      if (!transport) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Invalid or unknown Mcp-Session-Id',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res);
    });

    app.delete('/mcp', async (req: Request, res: Response) => {
      const sessionId = this.getSessionId(req);
      if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Mcp-Session-Id header is required',
          },
          id: null,
        });
        return;
      }

      const transport = this.httpSessionsById.get(sessionId)?.transport;
      if (!transport) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Invalid or unknown Mcp-Session-Id',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res);
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
   * Creates isolated MCP protocol server so each HTTP session owns its own
   * protocol lifecycle and repeated initialize calls do not collide.
   */
  private createProtocolServer(): McpServer {
    const server = new McpServer({ name: this.name, version: this.version });
    this.registerTools(server);
    return server;
  }

  /**
   * Creates and connects a new streamable HTTP transport for one MCP session.
   */
  private async createAndConnectHttpTransport(): Promise<StreamableHTTPServerTransport> {
    const server = this.createProtocolServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        this.httpSessionsById.set(sessionId, { server, transport });
      },
    });

    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) {
        this.httpSessionsById.delete(closedSessionId);
      }
    };

    await server.connect(transport);
    return transport;
  }

  /**
   * Returns trimmed MCP session header value or undefined when absent.
   */
  private getSessionId(req: Request): string | undefined {
    const rawSessionId = req.header('mcp-session-id');
    if (typeof rawSessionId !== 'string') {
      return undefined;
    }

    const sessionId = rawSessionId.trim();
    return sessionId.length > 0 ? sessionId : undefined;
  }

  /**
   * Parses bearer token with strict format so malformed headers fail closed.
   */
  private parseBearerToken(authHeader: string | undefined): string {
    if (typeof authHeader !== 'string') {
      return '';
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
      return '';
    }

    return parts[1] ?? '';
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
   * Executes inspection use-case directly for test and adapter-level callers.
   *
   * @param interactionId Durable interaction identifier previously returned by query.
   * @param topK Maximum evidence/pattern rows requested for inspection.
   * @returns Serializable inspection payload mirrored from MCP structuredContent.
   * @throws Error when interactionId is unknown or topK fails downstream validation.
   */
  public async executeInspectInteractionTool(
    interactionId: string,
    topK: number,
  ): Promise<Record<string, unknown>> {
    const result = await this.inspectInteractionUseCase.execute({ interactionId, topK });
    return { ...result } as Record<string, unknown>;
  }

  /**
   * Executes feedback use-case directly for test and adapter-level callers.
   *
   * @param interactionId Durable interaction identifier returned by query or one
   * of the interaction IDs returned in query matchedEvidence results.
   * @param qualityScore Normalized score in [0, 1] used to finalize learning quality.
   * @param route Optional route label attached to trajectory metadata.
   * @param knowledgeText Optional validated answer text that can become retrieval evidence.
   * @param forceLearnAfterFeedback Whether to trigger immediate learning after persistence.
   * @returns Serializable feedback payload mirrored from MCP structuredContent.
   * @throws Error when input validation fails or interaction cannot be completed.
   */
  public async executeFeedbackTool(
    interactionId: string,
    qualityScore: number,
    route: string | undefined,
    knowledgeText: string | undefined,
    forceLearnAfterFeedback: boolean,
  ): Promise<Record<string, unknown>> {
    const result = await this.feedbackUseCase.execute({
      interactionId,
      qualityScore,
      route,
      knowledgeText,
      forceLearnAfterFeedback,
    });

    return { ...result } as Record<string, unknown>;
  }

  /**
   * Executes forced learning directly for test and adapter-level callers.
   *
   * @returns Serializable learning status payload mirrored from MCP structuredContent.
   * @throws Error when underlying learning engine reports failure.
   */
  public async executeLearnTool(): Promise<Record<string, unknown>> {
    const result = await this.learnUseCase.execute();
    return { ...result } as Record<string, unknown>;
  }

  /**
   * Registers query, inspect_interaction, feedback, and learn tools with strict schemas.
   */
  private registerTools(server: McpServer): void {
    server.registerTool(
      'query',
      {
        description:
          'Embed query with all-MiniLM, apply SONA instant learning, and return interaction ID plus matched evidence and pattern summaries.',
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

    server.registerTool(
      'inspect_interaction',
      {
        description:
          'Inspect a prior query interaction by ID, replaying retrieval context when needed to expose matched evidence and pattern summaries.',
        inputSchema: {
          interactionId: z.string().uuid(),
          topK: z.number().int().min(1).max(20).default(5),
        },
      },
      async ({ interactionId, topK }) => {
        const result = await this.executeInspectInteractionTool(interactionId, topK);
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

    server.registerTool(
      'feedback',
      {
        description:
          'Attach quality signal to prior interaction, optionally persist validated knowledge text, and optionally trigger immediate learning.',
        inputSchema: {
          interactionId: z.string().uuid(),
          qualityScore: z.number().min(0).max(1),
          route: z.string().max(100).optional(),
          knowledgeText: z.string().min(1).max(20_000).optional(),
          forceLearnAfterFeedback: z.boolean().default(false),
        },
      },
      async ({ interactionId, qualityScore, route, knowledgeText, forceLearnAfterFeedback }) => {
        const result = await this.executeFeedbackTool(
          interactionId,
          qualityScore,
          route,
          knowledgeText,
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

    server.registerTool(
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
