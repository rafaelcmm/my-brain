-- Enable the extension once on bootstrap; production migrations can evolve later.
CREATE EXTENSION IF NOT EXISTS ruvector VERSION '0.1.0';

-- Surface startup visibility in DB logs so operator can verify extension load.
DO $$
BEGIN
    RAISE NOTICE 'ruvector version: %', ruvector_version();
END $$;

-- Keep learning enabled by default; orchestrator may still override behavior.
SELECT ruvector_enable_learning(true);
