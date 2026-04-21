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
    // Only pass safe environment variables to upstream subprocess.
    // Exclude MYBRAIN_* secrets to prevent leakage to untrusted upstream code.
    const safeEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (
        typeof value === "string" &&
        !key.startsWith("MYBRAIN_INTERNAL_") &&
        !key.includes("PASSWORD") &&
        !key.includes("SECRET") &&
        !key.includes("TOKEN") &&
        !key.includes("KEY")
      ) {
        safeEnv[key] = value;
      }
    }

    const transport = new StdioClientTransport({
      command: this.config.upstreamCommand,
      args: [...this.config.upstreamArgs],
      env: safeEnv,
    });

    try {
      await this.client.connect(transport);
      this.connected = true;
    } catch (error) {
      this.connected = false;
      // Sanitize error to avoid leaking internal paths or stack traces.
      const message = error instanceof Error ? error.message : "unknown error";
      const sanitized =
        message.length > 200 ? message.slice(0, 200) + "..." : message;
      process.stderr.write(
        `[my-brain] bridge upstream connection failed: ${sanitized}\n`,
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
