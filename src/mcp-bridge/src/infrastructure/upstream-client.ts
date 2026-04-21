import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { BridgeConfig, BridgeTool } from "../domain/types.js";

/**
 * Handles best-effort connection to legacy upstream MCP server.
 */
export class UpstreamClient {
  private readonly client = new Client(
    {
      name: "my-brain-mcp-bridge-upstream-client",
      version: "0.1.0",
    },
    {
      capabilities: {},
    },
  );

  private connected = false;

  /**
   * @param config Runtime bridge configuration.
   */
  constructor(private readonly config: BridgeConfig) {}

  /**
   * Establishes stdio connection to upstream MCP process.
   *
   * @returns Connection status after attempt.
   */
  async connect(): Promise<boolean> {
    const transport = new StdioClientTransport({
      command: this.config.upstreamCommand,
      args: [...this.config.upstreamArgs],
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    });

    try {
      await this.client.connect(transport);
      this.connected = true;
    } catch (error) {
      this.connected = false;
      process.stderr.write(
        `[my-brain] bridge upstream connection failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

    return this.connected;
  }

  /**
   * Indicates whether upstream connection is active.
   *
   * @returns True when upstream client connected successfully.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Lists upstream tools when connected.
   *
   * @returns Upstream tool list.
   */
  async listTools(): Promise<readonly BridgeTool[]> {
    if (!this.connected) {
      return [];
    }

    const upstream = await this.client.listTools();
    return (upstream.tools ?? []) as readonly BridgeTool[];
  }

  /**
   * Executes passthrough tool call against upstream client.
   *
   * @param name Tool name accepted by upstream server.
   * @param args Tool argument payload.
   * @returns Upstream response payload.
   */
  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool({
      name,
      arguments: args,
    });
  }
}
