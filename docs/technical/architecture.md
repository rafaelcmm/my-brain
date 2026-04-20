# my-brain Architecture

This document describes runtime architecture for local my-brain deployments.

## Components

1. Gateway (Caddy): ingress auth, routing, header sanitization.
2. MCP bridge: streamable MCP endpoint and tool facade.
3. Orchestrator: REST API, runtime bootstrap, memory/learning services.
4. Postgres: durable storage for vectors and metadata.
5. Ollama: local LLM and embedding backends.

## Data model

1. Vector memory remains managed by runtime engine internals.
2. Metadata sidecar table `my_brain_memory_metadata` stores scoped fields used by filtered recall.
3. ADR schemas `policy_memory`, `session_memory`, and `witness_memory` are created on orchestrator bootstrap.

## Request flow

1. Client calls gateway on `:3333/mcp` or `:8080/*` with bearer token.
2. Gateway validates token and strips `Authorization` before upstream.
3. MCP requests route to bridge; REST requests route to orchestrator/ollama.
4. Orchestrator coordinates model, vector, metadata, and learning paths.

## Runtime modes

Single full runtime profile is supported. Degraded capability signaling is exposed through orchestrator capabilities APIs so clients can adjust trust level.

## Design constraints

1. Default bind host remains `127.0.0.1`.
2. Secrets remain local-only and never committed.
3. Public endpoint changes require matching updates in reference docs.
