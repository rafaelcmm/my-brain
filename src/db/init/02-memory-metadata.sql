-- Metadata sidecar keeps scoped context independent from vector engine internals.
-- Memory id remains text to support multiple backend id formats.
CREATE TABLE IF NOT EXISTS my_brain_memory_metadata (
    id BIGSERIAL PRIMARY KEY,
    memory_id TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    -- SHA-1 of normalised content (lowercased, collapsed whitespace). Used for
    -- fingerprint-based dedup before the more expensive embedding similarity check.
    content_sha1 TEXT,
    -- Raw embedding as a JSONB array. Retained so the vector can be reconstructed
    -- without a live embedding model (e.g. migration, audit).
    embedding JSONB,
    -- Ruvector column. Dimension matches MYBRAIN_EMBEDDING_DIM (default 1024),
    -- which corresponds to qwen3-embedding:0.6b's output dimensionality.
    -- If the model changes, run: ALTER TABLE my_brain_memory_metadata
    --   ALTER COLUMN embedding_vector TYPE ruvector(N)
    -- Existing rows may retain NULL when embedding generation fails at write time.
    embedding_vector RUVECTOR(1024),
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
    -- Soft-delete: memory is hidden from default recall but recoverable via include_forgotten.
    forgotten_at TIMESTAMPTZ,
    -- Redaction: memory content is considered sensitive; hidden unless include_redacted is set.
    redacted_at TIMESTAMPTZ,
    use_count INTEGER NOT NULL DEFAULT 1,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence DOUBLE PRECISION,
    -- Bounded vote signal in [-0.15, 0.15] applied additively to the recall composite score.
    -- Computed as tanh((votes_up - votes_down) / max(1, max(votes_up, votes_down))) * 0.15.
    vote_bias DOUBLE PRECISION NOT NULL DEFAULT 0,
    visibility TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_scope
    ON my_brain_memory_metadata(scope);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_repo_language
    ON my_brain_memory_metadata(repo_name, language);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_type
    ON my_brain_memory_metadata(type);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_created_at
    ON my_brain_memory_metadata(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_tags
    ON my_brain_memory_metadata USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_frameworks
    ON my_brain_memory_metadata USING GIN (frameworks);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_sha1_scope
    ON my_brain_memory_metadata(content_sha1, scope);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_repo
    ON my_brain_memory_metadata(repo, repo_name);

-- HNSW (Hierarchical Navigable Small World) index for approximate nearest-neighbour
-- recall with cosine distance. M=16 and ef_construction=64 are tuned for a typical
-- memory corpus (10k–500k rows) with low false-negative tolerance. Increase
-- MYBRAIN_HNSW_EF_SEARCH at query time if recall precision degrades at large scale.
CREATE INDEX IF NOT EXISTS idx_my_brain_memory_metadata_embedding_hnsw
    ON my_brain_memory_metadata USING HNSW (embedding_vector ruvector_cosine_ops);
