-- Enable the extension once on bootstrap; production migrations can evolve later.
CREATE EXTENSION IF NOT EXISTS ruvector;

-- Surface startup visibility in DB logs so operator can verify extension load.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ruvector_version') THEN
        RAISE NOTICE 'ruvector version: %', ruvector_version();
    ELSE
        RAISE NOTICE 'ruvector extension installed (version function unavailable)';
    END IF;
END $$;
