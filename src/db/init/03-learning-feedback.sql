-- Feedback and session tracking tables wire memory outcomes into learning loops.
CREATE TABLE IF NOT EXISTS my_brain_memory_votes (
    id BIGSERIAL PRIMARY KEY,
    memory_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    reason TEXT,
    source TEXT,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_votes_memory_id
    ON my_brain_memory_votes(memory_id);

CREATE INDEX IF NOT EXISTS idx_my_brain_memory_votes_voted_at
    ON my_brain_memory_votes(voted_at DESC);

CREATE TABLE IF NOT EXISTS my_brain_sessions (
    session_id TEXT PRIMARY KEY,
    agent TEXT,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    success BOOLEAN,
    quality DOUBLE PRECISION,
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_my_brain_sessions_opened_at
    ON my_brain_sessions(opened_at DESC);
