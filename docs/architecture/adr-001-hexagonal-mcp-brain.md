# ADR-001: Hexagonal MCP Brain MVP

## Status

Accepted

## Context

Project needs self-hosted MCP server with three tools: query, feedback, learn.
Core behavior must stay independent from transport, embeddings runtime, and storage/learning engine.

## Decision

Use hexagonal architecture with strict inbound/outbound ports.

- Inbound adapter: MCP stdio server.
- Outbound adapters:
  - Embeddings adapter using all-MiniLM-L6-v2 via @xenova/transformers.
  - Learning/storage adapter using @ruvector/sona.
- Application layer contains query, feedback, learn use-cases.
- Domain stays framework-agnostic.

## Consequences

### Positive

- Core logic testable without MCP runtime or model download.
- Adapters replaceable (future HTTP MCP, remote embeddings, alternate learning engine).
- Clear ownership for behavior vs infrastructure.

### Trade-offs

- More files and wiring for MVP.
- Need mapping code between adapter DTOs and core DTOs.

## Layout

```text
src/
  core/
    domain/
    ports/
    application/
      dto/
      use-cases/
  adapters/
    inbound/mcp/
    outbound/embeddings/
    outbound/sona/
  shared/
    config/
  composition/
```

## Validation

- Domain and use-cases import no MCP SDK, no @xenova/transformers, no @ruvector/sona.
- Server adapter depends on application ports only.
- Composition root performs all wiring.
