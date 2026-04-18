import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { normalize, resolve } from 'node:path';

interface ClearDbOptions {
  readonly envFile: string;
  readonly force: boolean;
  readonly dryRun: boolean;
}

const composeServiceName = 'brain-mcp';

/**
 * Prints CLI usage for the database-clear helper.
 */
function printUsage(): void {
  console.log(`Usage: yarn db:clear --force [--dry-run] [--env-file <path>]

Options:
  --force            Stop the Docker service if needed and delete DB files from the mounted volume.
  --dry-run          Print the Docker actions and target files without deleting them.
  --env-file <path>  Load a specific .env file instead of <repo>/.env.
  -h, --help         Show this help.

Docker flow:
  1. Detect whether ${composeServiceName} is currently running.
  2. Stop ${composeServiceName} when active so the DB is not mutated in-place.
  3. Run a one-off Compose container that removes DB artifacts from /data.
  4. Start ${composeServiceName} again if it was running before the reset.
`);
}

/**
 * Parses CLI flags while keeping destructive behavior gated behind --force.
 */
function parseArgs(argv: readonly string[]): ClearDbOptions {
  let envFile = resolve(process.cwd(), '.env');
  let force = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--force') {
      force = true;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--env-file') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--env-file requires a path value.');
      }

      envFile = resolve(process.cwd(), value);
      index += 1;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { envFile, force, dryRun };
}

/**
 * Validates the configured DB path so the wipe script cannot target arbitrary files.
 */
function resolveStoragePath(rawPath: string): string {
  const normalized = normalize(rawPath);

  if (normalized.includes('..')) {
    throw new Error('RUVECTOR_DB_PATH must not contain parent directory traversal.');
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

    throw new Error('RUVECTOR_DB_PATH absolute path must be under /data or /models.');
  }

  return resolve(process.cwd(), normalized);
}

/**
 * Returns all durable files created by the current memory persistence strategy.
 */
function buildCandidatePaths(databasePath: string): readonly string[] {
  return [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
    `${databasePath}.interactions.json`,
  ];
}

/**
 * Builds a `docker compose` invocation that honors the selected env file.
 */
function buildComposeArgs(options: ClearDbOptions, args: readonly string[]): string[] {
  return ['compose', '--env-file', options.envFile, ...args];
}

/**
 * Executes a Docker or Compose command and returns trimmed stdout.
 */
function runDockerCommand(args: readonly string[]): string {
  return execFileSync('docker', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Detects whether the main Compose service is running before the reset begins.
 */
function isServiceRunning(options: ClearDbOptions): boolean {
  const stdout = runDockerCommand(
    buildComposeArgs(options, ['ps', '--status', 'running', '-q', composeServiceName]),
  );
  return stdout.length > 0;
}

/**
 * Stops the main Compose service so the mounted database volume is quiescent.
 */
function stopService(options: ClearDbOptions): void {
  runDockerCommand(buildComposeArgs(options, ['stop', composeServiceName]));
}

/**
 * Starts the main Compose service after a reset when it had been running before.
 */
function startService(options: ClearDbOptions): void {
  runDockerCommand(buildComposeArgs(options, ['start', composeServiceName]));
}

/**
 * Clears DB artifacts from the Docker-mounted data volume using a one-off container.
 */
function clearVolumeFiles(options: ClearDbOptions, candidatePaths: readonly string[]): void {
  const shellCommand = `rm -f ${candidatePaths.map((path) => `'${path}'`).join(' ')}`;
  runDockerCommand(
    buildComposeArgs(options, [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'sh',
      composeServiceName,
      '-c',
      shellCommand,
    ]),
  );
}

/**
 * Deletes all known DB artifacts from the Docker volume and restores service state.
 */
async function clearDatabase(options: ClearDbOptions): Promise<void> {
  loadEnv({ path: options.envFile, quiet: true });

  const databasePath = resolveStoragePath(process.env.RUVECTOR_DB_PATH ?? '/data/ruvector.db');
  const candidatePaths = buildCandidatePaths(databasePath);

  console.log(`Compose service: ${composeServiceName}`);
  console.log(`Env file: ${options.envFile}`);
  for (const candidatePath of candidatePaths) {
    console.log(`${options.dryRun ? 'Would clear' : 'Target file'} ${candidatePath}`);
  }

  if (!options.force && !options.dryRun) {
    throw new Error('Refusing to clear Docker volume data without --force.');
  }

  const serviceWasRunning = options.dryRun ? false : isServiceRunning(options);
  if (options.dryRun) {
    console.log(
      `Would inspect service state with: docker ${buildComposeArgs(options, ['ps', '--status', 'running', '-q', composeServiceName]).join(' ')}`,
    );
    console.log(
      `Would clear data with: docker ${buildComposeArgs(options, ['run', '--rm', '--no-deps', '--entrypoint', 'sh', composeServiceName, '-c', `rm -f ${candidatePaths.join(' ')}`]).join(' ')}`,
    );
    return;
  }

  if (serviceWasRunning) {
    console.log(`Stopping ${composeServiceName} before clearing mounted data ...`);
    stopService(options);
  }

  try {
    console.log('Clearing Docker volume data ...');
    clearVolumeFiles(options, candidatePaths);
  } finally {
    if (serviceWasRunning) {
      console.log(`Restarting ${composeServiceName} after volume reset ...`);
      startService(options);
    }
  }
}

/**
 * Entrypoint for the database-clear CLI.
 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await clearDatabase(options);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`clear-db failed: ${message}`);
  process.exitCode = 1;
});
