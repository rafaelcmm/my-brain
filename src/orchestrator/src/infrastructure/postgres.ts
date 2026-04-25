/**
 * Postgres connection management and schema bootstrap for the orchestrator.
 *
 * Responsible for:
 * - Creating the shared Pool used by all infra callers.
 * - Ensuring ADR memory schemas and the core metadata table exist before traffic.
 * - Running idempotent ALTER TABLE migrations so the service can be deployed on
 *   top of an older DB without manual schema changes.
 * - Initializing the database and reporting result into caller-owned state objects
 *   rather than mutating module-level globals — keeps the function side-effects
 *   explicit and testable.
 */

import { Pool } from "pg";
import { ADR_SCHEMAS } from "../domain/types.js";

/**
 * Subset of orchestrator config needed to establish a Postgres connection.
 */
export interface PostgresConfig {
  /** libpq-compatible connection string. Empty string when DB is unconfigured. */
  readonly dbUrl: string;
  /** Embedding vector dimension used to size the ruvector column. */
  readonly embeddingDim: number;
}

/**
 * Mutable DB state record updated in-place by initialization to avoid exposing
 * internal runtime object shapes across module boundaries.
 */
export interface DbState {
  /** Whether the pool successfully reached the database at startup. */
  connected: boolean;
  /** ruvector extension version string as reported by pg_extension, or null. */
  extensionVersion: string | null;
  /** Whether ADR and metadata schemas were created or confirmed present. */
  adrSchemasReady: boolean;
  /** Last error message string recorded during initialization, or null. */
  error: string | null;
}

/**
 * Creates a new Postgres pool configured from the provided connection string.
 *
 * The pool is created lazily — no connection is established until the first
 * query. Callers should retain the pool across the service lifetime.
 *
 * @param dbUrl - libpq-compatible connection string.
 * @returns Configured Pool instance ready for use.
 */
export function createPool(dbUrl: string): Pool {
  return new Pool({ connectionString: dbUrl });
}

/**
 * Ensures all ADR-related schemas and the core memory metadata table exist.
 *
 * All DDL statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 * so this function can be called on every startup without risk of data loss.
 * ALTER TABLE statements fill in columns added after initial deployment.
 *
 * The HNSW index on embedding_vector uses cosine similarity to match the
 * scoring function used at recall time.
 *
 * @param pool - Active Postgres pool.
 * @param embeddingDim - Vector dimension used by the ruvector column type.
 * @returns Resolves when all schemas and tables are confirmed present.
 */
export async function ensureAdrSchemas(
  pool: Pool,
  embeddingDim: number,
): Promise<void> {
  for (const schema of ADR_SCHEMAS) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.entries (
        id BIGSERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'general',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_brain_memory_metadata (
      id BIGSERIAL PRIMARY KEY,
      memory_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      content_sha1 TEXT,
      embedding JSONB,
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      repo TEXT,
      repo_name TEXT,
      project TEXT,
      language TEXT,
      frameworks JSONB NOT NULL DEFAULT '[]'::jsonb,
      path TEXT,
      symbol TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      source TEXT,
      author TEXT,
      agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      forgotten_at TIMESTAMPTZ,
      redacted_at TIMESTAMPTZ,
      use_count INTEGER NOT NULL DEFAULT 1,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confidence DOUBLE PRECISION,
      vote_bias DOUBLE PRECISION NOT NULL DEFAULT 0,
      visibility TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  // Idempotent compatibility migrations — apply any columns added after the initial
  // table creation so the service can deploy onto an older database.
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS content_sha1 TEXT",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS embedding JSONB",
  );
  await pool.query(
    `ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS embedding_vector ruvector(${embeddingDim})`,
  );
  await pool.query(
    `ALTER TABLE my_brain_memory_metadata ALTER COLUMN embedding_vector TYPE ruvector(${embeddingDim}) USING CASE WHEN embedding_vector IS NULL THEN NULL ELSE (embedding_vector::text)::ruvector(${embeddingDim}) END`,
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS forgotten_at TIMESTAMPTZ",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 1",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  );
  await pool.query(
    "ALTER TABLE my_brain_memory_metadata ADD COLUMN IF NOT EXISTS vote_bias DOUBLE PRECISION NOT NULL DEFAULT 0",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_sha1_scope ON my_brain_memory_metadata(content_sha1, scope)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_repo ON my_brain_memory_metadata(repo, repo_name)",
  );
  // HNSW cosine index mirrors the scoring function used at recall time.
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_embedding_hnsw ON my_brain_memory_metadata USING hnsw (embedding_vector ruvector_cosine_ops)",
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_brain_memory_votes (
      id BIGSERIAL PRIMARY KEY,
      memory_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      reason TEXT,
      source TEXT,
      voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_brain_sessions (
      session_id TEXT PRIMARY KEY,
      agent TEXT,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      success BOOLEAN,
      quality DOUBLE PRECISION,
      reason TEXT
    )
  `);
}

/**
 * Initializes a Postgres pool and validates that the ruvector extension is installed.
 *
 * Mutates the caller-provided `state` object to report connectivity status.
 * Does not throw — all error paths are recorded to `state.error` so the runtime
 * can degrade gracefully and the service can still bind and answer health checks.
 *
 * @param config - Postgres config slice from orchestrator config.
 * @param state - Mutable state record updated in place with connection outcome.
 * @param pushDegradedReason - Callback that records a degradation reason string.
 * @returns The initialized Pool, or null when initialization failed.
 */
export async function initializeDatabase(
  config: PostgresConfig,
  state: DbState,
  pushDegradedReason: (reason: string) => void,
): Promise<Pool | null> {
  if (!config.dbUrl) {
    state.error = "MYBRAIN_DB_URL not configured";
    pushDegradedReason("database url missing");
    return null;
  }

  const pool = createPool(config.dbUrl);

  try {
    const versionResult = await pool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'ruvector' LIMIT 1",
    );
    const extensionVersion = versionResult.rows[0]?.extversion as
      | string
      | undefined;

    if (!extensionVersion) {
      state.error = "ruvector extension not installed";
      pushDegradedReason("ruvector extension missing");
      return null;
    }

    state.connected = true;
    state.extensionVersion = extensionVersion;

    await ensureAdrSchemas(pool, config.embeddingDim);
    state.adrSchemasReady = true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    pushDegradedReason("database bootstrap failed");
    return null;
  }

  return pool;
}
