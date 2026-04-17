import { createApp } from './composition/create-app.js';

/**
 * Runtime entrypoint for stdio MCP server process.
 */
async function main(): Promise<void> {
  const app = createApp();
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
