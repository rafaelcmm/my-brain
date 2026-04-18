import { config as loadEnv } from 'dotenv';
import { normalize, resolve } from 'node:path';
import { FileAuthTokenAdapter } from '../adapters/outbound/security/file-auth-token-adapter.js';

/**
 * TokenCommand defines supported token lifecycle operations for production-safe
 * CLI usage where runtime image does not include TypeScript tooling.
 */
type TokenCommand = 'init' | 'rotate';

/**
 * ManageTokenOptions stores validated command intent so parsing concerns stay
 * isolated from state-changing token operations.
 */
interface ManageTokenOptions {
  /** Command verb controlling whether store is initialized or rotated. */
  readonly command: TokenCommand;
  /** Absolute path to env file loaded before resolving auth store location. */
  readonly envFile: string;
  /** Operator label persisted with issued token metadata for auditability. */
  readonly label: string;
  /** Optional token lifetime in days; undefined means token has no expiry. */
  readonly ttlDays?: number;
  /** Optional bootstrap secret used only during init when store is empty. */
  readonly bootstrapToken?: string;
}

const TOKEN_MIN_LENGTH = 32;

/**
 * Prints operational help for token initialization and rotation commands.
 */
function printUsage(): void {
  console.log(`Usage:
  node dist/cli/manage-auth-token.js init [--label <name>] [--ttl-days <days>] [--env-file <path>] [--bootstrap-token <secret>]
  node dist/cli/manage-auth-token.js init [--label <name>] [--ttl-days <days>] [--env-file <path>] [--bootstrap-token-env <VAR_NAME>]
  node dist/cli/manage-auth-token.js rotate [--label <name>] [--ttl-days <days>] [--env-file <path>]

Options:
  --label <name>             Human-readable label stored with token metadata.
  --ttl-days <days>          Optional positive integer expiration window in days.
  --env-file <path>          Env file used to resolve MCP_AUTH_STORE_PATH.
  --bootstrap-token <secret> Seed token used only by init when store is empty (less secure in shell history).
  --bootstrap-token-env <k>  Environment variable holding bootstrap token value.
  -h, --help                 Show help.

Notes:
  - Tokens are persisted as hashes only and cannot be recovered later.
  - Generated plaintext token is printed once. Save immediately.
`);
}

/**
 * Parses CLI arguments and enforces option invariants before mutation.
 *
 * @param argv Raw process arguments after node/script prefix.
 * @returns Validated options for downstream token lifecycle execution.
 * @throws Error When command is unsupported, option value is missing, or
 * numeric constraints are invalid.
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

    if (arg === '--bootstrap-token-env') {
      const envKey = argv[index + 1];
      if (!envKey) {
        throw new Error('--bootstrap-token-env requires an environment variable name.');
      }

      const value = process.env[envKey];
      if (!value || value.trim().length < TOKEN_MIN_LENGTH) {
        throw new Error(`${envKey} must be set and be at least ${TOKEN_MIN_LENGTH} characters.`);
      }

      bootstrapToken = value.trim();
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
 * Restricts token store writes to approved runtime-safe directories to prevent
 * accidental traversal outside expected persistence volumes.
 *
 * @param rawPath Candidate MCP_AUTH_STORE_PATH from environment or defaults.
 * @returns Normalized absolute or approved container path for token storage.
 * @throws Error When path escapes approved roots or uses traversal segments.
 */
function validateStorePath(rawPath: string): string {
  const normalized = normalize(rawPath);

  if (normalized.includes('..')) {
    throw new Error('MCP_AUTH_STORE_PATH must not contain parent directory traversal.');
  }

  if (normalized.startsWith('/')) {
    const resolvedPath = resolve(normalized);
    const isAllowedRoot = resolvedPath === '/data' || resolvedPath === '/models';
    const isAllowedDescendant =
      resolvedPath.startsWith('/data/') || resolvedPath.startsWith('/models/');

    if (isAllowedRoot || isAllowedDescendant) {
      return resolvedPath;
    }

    throw new Error('MCP_AUTH_STORE_PATH absolute path must be under /data or /models.');
  }

  return resolve(process.cwd(), normalized);
}

/**
 * Executes token lifecycle operation using persisted hash-backed token store.
 *
 * @param options Validated command options controlling init or rotate
 * behavior.
 * @throws Error Propagates validation, filesystem, and adapter operation
 * failures.
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
      'If you seeded with bootstrap token, rotate now with: node dist/cli/manage-auth-token.js rotate --label "post-bootstrap-rotate"',
    );
    return;
  }

  const issued = adapter.issueToken(options.label, options.ttlDays);
  console.log(`Token id: ${issued.tokenId}`);
  console.log(`Token value (shown once): ${issued.token}`);
}

/**
 * Entrypoint keeps process error boundary deterministic for operator scripts.
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
