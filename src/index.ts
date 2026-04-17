import { createApp } from './composition/create-app.js';
import { loadRuntimeConfig } from './shared/config/env.js';

/**
 * Runtime entrypoint for stdio MCP server process.
 */
async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const app = createApp();

  if (config.mcpTransport === 'http') {
    await app.startHttp(config.mcpHttpPort, config.mcpHttpHost);
    return;
  }

  await app.startStdio();
}

void main().catch((error: unknown) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const message =
    error instanceof Error
      ? isProduction
        ? error.message
        : (error.stack ?? error.message)
      : String(error);
  // stderr output is intentional because stdio stdout is reserved for MCP protocol frames.
  console.error(`Fatal startup error: ${message}`);
  process.exitCode = 1;
});
