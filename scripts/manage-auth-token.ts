import { config as loadEnv } from 'dotenv';
import { normalize, resolve } from 'node:path';
import { FileAuthTokenAdapter } from '../src/adapters/outbound/security/file-auth-token-adapter.js';

/**
 * TokenCommand selects whether CLI should initialize store state or rotate
 * credentials by issuing a new token.
 */
type TokenCommand = 'init' | 'rotate';

/**
 * ManageTokenOptions defines validated CLI intent for token initialization or
 * rotation without mixing argument parsing with command execution logic.
 */
interface ManageTokenOptions {
  readonly command: TokenCommand;
  readonly envFile: string;
  readonly label: string;
  readonly ttlDays?: number;
  readonly bootstrapToken?: string;
}

const TOKEN_MIN_LENGTH = 32;

/**
 * Prints CLI usage for persisted MCP auth token management.
 */
function printUsage(): void {
  console.log(`Usage:
  yarn auth:token:init [--label <name>] [--ttl-days <days>] [--env-file <path>] [--bootstrap-token <secret>]
  yarn auth:token:rotate [--label <name>] [--ttl-days <days>] [--env-file <path>]

Options:
  --label <name>             Human-readable label stored with token metadata.
  --ttl-days <days>          Optional positive integer expiration window in days.
  --env-file <path>          Env file used to resolve MCP_AUTH_STORE_PATH.
  --bootstrap-token <secret> Seed token used only by init when store is empty.
  -h, --help                 Show help.

Notes:
  - Tokens are persisted as hashes only and cannot be recovered later.
  - Generated plaintext token is printed once. Save immediately.
`);
}

/**
 * Parses CLI arguments into deterministic command options.
 */
function parseArgs(argv: readonly string[]): ManageTokenOptions {
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const rawCommand = argv[0];
  if (rawCommand !== 'init' && rawCommand !== 'rotate') {
    throw new Error("First argument must be 'init' or 'rotate'.");
  }

  let envFile = resolve(process.cwd(), '.env');
  let label = rawCommand === 'init' ? 'manual-init' : 'manual-rotate';
  let ttlDays: number | undefined;
  let bootstrapToken: string | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--env-file') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--env-file requires a path value.');
      }

      envFile = resolve(process.cwd(), value);
      index += 1;
      continue;
    }

    if (arg === '--label') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--label requires a value.');
      }

      label = value;
      index += 1;
      continue;
    }

    if (arg === '--ttl-days') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--ttl-days requires a value.');
      }

      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--ttl-days must be a positive integer.');
      }

      ttlDays = parsed;
      index += 1;
      continue;
    }

    if (arg === '--bootstrap-token') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--bootstrap-token requires a value.');
      }

      if (value.trim().length < TOKEN_MIN_LENGTH) {
        throw new Error(`--bootstrap-token must be at least ${TOKEN_MIN_LENGTH} characters.`);
      }

      bootstrapToken = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    command: rawCommand,
    envFile,
    label,
    ttlDays,
    bootstrapToken,
  };
}

/**
 * Validates persisted token store path against restricted project-safe roots.
 */
function validateStorePath(rawPath: string): string {
  const normalized = normalize(rawPath);

  if (normalized.includes('..')) {
    throw new Error('MCP_AUTH_STORE_PATH must not contain parent directory traversal.');
  }

  if (normalized.startsWith('/')) {
    if (
      normalized === '/data' ||
      normalized === '/models' ||
      normalized.startsWith('/data/') ||
      normalized.startsWith('/models/')
    ) {
      return normalized;
    }

    throw new Error('MCP_AUTH_STORE_PATH absolute path must be under /data or /models.');
  }

  return resolve(process.cwd(), normalized);
}

/**
 * Issues/revokes persisted tokens based on command mode.
 */
function execute(options: ManageTokenOptions): void {
  loadEnv({ path: options.envFile, quiet: true });
  const storePath = validateStorePath(
    process.env.MCP_AUTH_STORE_PATH ?? '/data/mcp-auth-tokens.json',
  );
  const adapter = new FileAuthTokenAdapter(storePath);

  if (options.command === 'init') {
    adapter.ensureActiveToken(options.bootstrapToken ?? process.env.MCP_AUTH_TOKEN?.trim());
    console.log(`Auth token store ready at ${storePath}`);
    console.log(
      'If you seeded with bootstrap token, rotate now with: yarn auth:token:rotate --label "post-bootstrap-rotate"',
    );
    return;
  }

  const issued = adapter.issueToken(options.label, options.ttlDays);
  console.log(`Token id: ${issued.tokenId}`);
  console.log(`Token value (shown once): ${issued.token}`);
}

/**
 * Entrypoint for auth token management commands.
 */
function main(): void {
  const options = parseArgs(process.argv.slice(2));
  execute(options);
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`manage-auth-token failed: ${message}`);
  process.exitCode = 1;
}
