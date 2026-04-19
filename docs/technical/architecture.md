# Architecture

## Overview

my-brain runs four core services in memory mode:

1. my-brain-db: ruvector-postgres memory substrate.
2. my-brain-orchestrator: runtime control plane and REST health/status.
3. my-brain-mcp: MCP bridge exposing SSE endpoint.
4. my-brain-gateway: auth edge for both MCP and REST ingress.

In full mode, my-brain-llm and my-brain-llm-init are added for local generation.

## Request Flow

1. Client sends request with bearer token to gateway.
2. Gateway validates token against matcher rendered by install and rotation scripts.
3. Gateway strips Authorization header.
4. Gateway proxies to MCP service on port 3333 or orchestrator on port 8080.

## Security Boundaries

1. Only gateway exposes host ports.
2. Internal services remain on Docker network.
3. Token file lives under .secrets with 700/600 permissions.
4. Token rotation is file-based and script-triggered gateway reload applies new token.

## Install and Ops Lifecycle

1. install.sh clones or updates repo, generates secrets, writes .env, boots stack.
2. smoke-test.sh verifies auth gates and basic endpoint behavior.
3. rotate-token.sh rotates token atomically and preserves previous token file.
