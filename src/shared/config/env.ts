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

  /** Path for persistent ruvector database file used for long-term memory. */
  readonly ruvectorDbPath: string;

  /** MCP transport mode for process entrypoint. */
  readonly mcpTransport: 'stdio' | 'http';

  /** HTTP bind host when using HTTP transport. */
  readonly mcpHttpHost: string;

  /** HTTP bind port when using HTTP transport. */
  readonly mcpHttpPort: number;

  /** Bearer token required for HTTP MCP requests. Required in HTTP transport. */
  readonly mcpAuthToken?: string;

  /** Optional CORS origin allow-list for HTTP transport. */
  readonly mcpAllowedOrigins: readonly string[];

  /** Max allowed HTTP request body size in bytes for MCP endpoint. */
  readonly mcpMaxBodyBytes: number;

  /** HTTP rate-limit window size in milliseconds. */
  readonly mcpRateLimitWindowMs: number;

  /** Max requests per rate-limit window for MCP endpoint. */
  readonly mcpRateLimitMax: number;

  /** Embedding provider implementation key. */
  readonly embeddingProvider: 'minilm' | 'hash';

  /** Use quantized model weights in transformers pipeline. */
  readonly embeddingQuantized: boolean;

  /** SONA micro LoRA rank. */
  readonly sonaMicroLoraRank: number;

  /** SONA base LoRA rank. */
  readonly sonaBaseLoraRank: number;

  /** SONA micro LoRA learning rate. */
  readonly sonaMicroLoraLr: number;

  /** SONA quality threshold. */
  readonly sonaQualityThreshold: number;

  /** SONA pattern cluster count. */
  readonly sonaPatternClusters: number;

  /** SONA EWC lambda parameter. */
  readonly sonaEwcLambda: number;
}

function parseBooleanEnv(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseNumberEnv(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAllowedOrigins(rawValue: string | undefined): readonly string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
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
    if (
      normalized === '/data' ||
      normalized === '/models' ||
      normalized.startsWith('/data/') ||
      normalized.startsWith('/models/')
    ) {
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
  const mcpHttpPortRaw = process.env.MCP_HTTP_PORT ?? '3737';
  const mcpHttpPort = Number.parseInt(mcpHttpPortRaw, 10);
  const sonaMicroLoraRank = Number.parseInt(process.env.SONA_MICRO_LORA_RANK ?? '2', 10);
  const sonaBaseLoraRank = Number.parseInt(process.env.SONA_BASE_LORA_RANK ?? '16', 10);
  const sonaPatternClusters = Number.parseInt(process.env.SONA_PATTERN_CLUSTERS ?? '100', 10);
  const sonaMicroLoraLr = Number.parseFloat(process.env.SONA_MICRO_LORA_LR ?? '0.002');
  const sonaQualityThreshold = Number.parseFloat(process.env.SONA_QUALITY_THRESHOLD ?? '0.3');
  const sonaEwcLambda = Number.parseFloat(process.env.SONA_EWC_LAMBDA ?? '2000');
  const mcpMaxBodyBytes = parseNumberEnv(process.env.MCP_MAX_BODY_BYTES, 1_048_576);
  const mcpRateLimitWindowMs = parseNumberEnv(process.env.MCP_RATE_LIMIT_WINDOW_MS, 60_000);
  const mcpRateLimitMax = parseNumberEnv(process.env.MCP_RATE_LIMIT_MAX, 120);

  if (!Number.isFinite(embeddingDim) || embeddingDim <= 0) {
    throw new Error('EMBEDDING_DIM must be a positive integer.');
  }
  if (!Number.isFinite(mcpHttpPort) || mcpHttpPort <= 0) {
    throw new Error('MCP_HTTP_PORT must be a positive integer.');
  }
  if (!Number.isFinite(mcpMaxBodyBytes) || mcpMaxBodyBytes <= 0) {
    throw new Error('MCP_MAX_BODY_BYTES must be a positive integer.');
  }
  if (!Number.isFinite(mcpRateLimitWindowMs) || mcpRateLimitWindowMs <= 0) {
    throw new Error('MCP_RATE_LIMIT_WINDOW_MS must be a positive integer.');
  }
  if (!Number.isFinite(mcpRateLimitMax) || mcpRateLimitMax <= 0) {
    throw new Error('MCP_RATE_LIMIT_MAX must be a positive integer.');
  }
  if (!Number.isFinite(sonaMicroLoraRank) || sonaMicroLoraRank < 1 || sonaMicroLoraRank > 2) {
    throw new Error('SONA_MICRO_LORA_RANK must be 1 or 2.');
  }
  if (!Number.isFinite(sonaBaseLoraRank) || sonaBaseLoraRank < 1) {
    throw new Error('SONA_BASE_LORA_RANK must be a positive integer.');
  }
  if (!Number.isFinite(sonaPatternClusters) || sonaPatternClusters < 1) {
    throw new Error('SONA_PATTERN_CLUSTERS must be a positive integer.');
  }
  if (!Number.isFinite(sonaMicroLoraLr) || sonaMicroLoraLr <= 0) {
    throw new Error('SONA_MICRO_LORA_LR must be a positive number.');
  }
  if (
    !Number.isFinite(sonaQualityThreshold) ||
    sonaQualityThreshold < 0 ||
    sonaQualityThreshold > 1
  ) {
    throw new Error('SONA_QUALITY_THRESHOLD must be in range [0, 1].');
  }
  if (!Number.isFinite(sonaEwcLambda) || sonaEwcLambda <= 0) {
    throw new Error('SONA_EWC_LAMBDA must be a positive number.');
  }

  const mcpTransportRaw = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();
  if (mcpTransportRaw !== 'stdio' && mcpTransportRaw !== 'http') {
    throw new Error("MCP_TRANSPORT must be either 'stdio' or 'http'.");
  }

  const mcpAuthToken = process.env.MCP_AUTH_TOKEN?.trim();
  if (mcpTransportRaw === 'http' && (!mcpAuthToken || mcpAuthToken.length < 16)) {
    throw new Error(
      'MCP_AUTH_TOKEN is required in HTTP transport and must be at least 16 characters.',
    );
  }

  const embeddingProviderRaw = (process.env.EMBEDDING_PROVIDER ?? 'minilm').toLowerCase();
  if (embeddingProviderRaw !== 'minilm' && embeddingProviderRaw !== 'hash') {
    throw new Error("EMBEDDING_PROVIDER must be either 'minilm' or 'hash'.");
  }

  const modelCacheDir = validatePathEnv(
    process.env.MODEL_CACHE_DIR ?? '/models',
    'MODEL_CACHE_DIR',
  );
  const ruvectorDbPath = validatePathEnv(
    process.env.RUVECTOR_DB_PATH ?? '/data/ruvector.db',
    'RUVECTOR_DB_PATH',
  );

  return {
    serverName: process.env.MCP_SERVER_NAME ?? 'my-brain',
    serverVersion: process.env.MCP_SERVER_VERSION ?? '0.1.0',
    embeddingModelId: process.env.EMBEDDING_MODEL_ID ?? 'sentence-transformers/all-MiniLM-L6-v2',
    embeddingDim,
    modelCacheDir,
    ruvectorDbPath,
    mcpTransport: mcpTransportRaw,
    mcpHttpHost: process.env.MCP_HTTP_HOST ?? '127.0.0.1',
    mcpHttpPort,
    mcpAuthToken,
    mcpAllowedOrigins: parseAllowedOrigins(process.env.MCP_ALLOWED_ORIGINS),
    mcpMaxBodyBytes,
    mcpRateLimitWindowMs,
    mcpRateLimitMax,
    embeddingProvider: embeddingProviderRaw,
    embeddingQuantized: parseBooleanEnv(process.env.EMBEDDING_QUANTIZED, false),
    sonaMicroLoraRank,
    sonaBaseLoraRank,
    sonaMicroLoraLr,
    sonaQualityThreshold,
    sonaPatternClusters,
    sonaEwcLambda,
  };
}
