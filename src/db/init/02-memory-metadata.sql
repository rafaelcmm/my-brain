-- Metadata sidecar keeps scoped context independent from vector engine internals.
-- Memory id remains text to support multiple backend id formats.
CREATE TABLE IF NOT EXISTS my_brain_memory_metadata (
    id BIGSERIAL PRIMARY KEY,
    memory_id TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
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
    confidence DOUBLE PRECISION,
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
