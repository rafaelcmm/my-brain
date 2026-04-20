# Local Operations Runbook

## Bring Up

1. cp .env.example .env
2. Edit MYBRAIN_DB_PASSWORD in .env if needed.
3. mkdir -p .secrets
4. Generate token:
   openssl rand -base64 96 | tr -d '/+=\n' | cut -c1-64 | sed 's/^/my-brain-/' > .secrets/auth-token
5. chmod 700 .secrets && chmod 600 .secrets/auth-token
6. printf 'unused-placeholder' > .secrets/auth-token.previous && chmod 600 .secrets/auth-token.previous
7. docker compose up -d
8. ./src/scripts/smoke-test.sh

## Rotate Token

1. ./src/scripts/rotate-token.sh
2. Update client header configuration.
3. Re-run ./src/scripts/smoke-test.sh

## Tear Down

1. docker compose down
2. Optional full cleanup: docker compose down -v
