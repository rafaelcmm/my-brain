import { config as loadEnv } from 'dotenv';
import { normalize, resolve } from 'node:path';

loadEnv();

/**
 * Runtime configuration required by composition root.
 */
export interface RuntimeConfig {
  /** MCP server name presented to clients. */
  readonly serverName: string;

  /** MCP server version presented to clients. */
  readonly serverVersion: string;

  /** Embedding model identifier for @xenova/transformers pipeline. */
  readonly embeddingModelId: string;

  /** Embedding vector dimension expected by SONA engine. */
  readonly embeddingDim: number;

  /** Optional local cache directory for model files. */
  readonly modelCacheDir?: string;

  /** Path for append-only SONA event log used for restart replay. */
  readonly sonaEventsFilePath: string;
}

/**
 * Validates path-like env values to block traversal and dangerous absolute paths.
 *
 * Allowed absolute paths are limited to container-mounted directories used by
 * this project. Relative paths resolve under current working directory.
 */
function validatePathEnv(rawPath: string, envName: string): string {
  const normalized = normalize(rawPath);

  if (normalized.includes('..')) {
    throw new Error(`${envName} must not contain parent directory traversal.`);
  }

  if (normalized.startsWith('/')) {
    if (normalized.startsWith('/data/') || normalized.startsWith('/models/')) {
      return normalized;
    }

    throw new Error(`${envName} absolute path must be under /data or /models.`);
  }

  return resolve(process.cwd(), normalized);
}

/**
 * Reads environment and validates required runtime settings.
 */
export function loadRuntimeConfig(): RuntimeConfig {
  const embeddingDimRaw = process.env.EMBEDDING_DIM ?? '384';
  const embeddingDim = Number.parseInt(embeddingDimRaw, 10);

  if (!Number.isFinite(embeddingDim) || embeddingDim <= 0) {
    throw new Error('EMBEDDING_DIM must be a positive integer.');
  }

  const modelCacheDir = validatePathEnv(
    process.env.MODEL_CACHE_DIR ?? '.data/models',
    'MODEL_CACHE_DIR',
  );
  const sonaEventsFilePath = validatePathEnv(
    process.env.SONA_EVENTS_FILE_PATH ?? '.data/sona-events.ndjson',
    'SONA_EVENTS_FILE_PATH',
  );

  return {
    serverName: process.env.MCP_SERVER_NAME ?? 'my-brain',
    serverVersion: process.env.MCP_SERVER_VERSION ?? '0.1.0',
    embeddingModelId: process.env.EMBEDDING_MODEL_ID ?? 'sentence-transformers/all-MiniLM-L6-v2',
    embeddingDim,
    modelCacheDir,
    sonaEventsFilePath,
  };
}
