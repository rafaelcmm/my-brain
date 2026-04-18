# ADR-001: Hexagonal Architecture For MCP Brain

## Status

Accepted

## Context

The service must evolve quickly across transport, embedding, and adaptive-brain providers without forcing domain use-case rewrites. Early versions already combine MCP transport, embedding generation, and SONA learning. Coupling these concerns directly would make security hardening and provider swaps high-risk.

## Decision

Adopt hexagonal architecture with explicit boundaries:

- Core domain and use-cases remain framework-agnostic.
- Ports define required capabilities (`EmbeddingsPort`, `AdaptiveBrainPort`, `AuthTokenPort`).
- Inbound adapter exposes MCP tools and HTTP transport concerns.
- Outbound adapters implement embeddings, adaptive brain, and persisted auth token storage.
- Composition root wires runtime config to concrete adapters.

## Consequences

Positive:

- Security and performance improvements at adapter layer do not leak into use-cases.
- Provider replacement (embedding model, persistence backend) stays low-risk.
- Unit tests can target core logic without infrastructure dependencies.

Trade-offs:

- Extra interfaces and mapping code increase initial verbosity.
- Strict boundaries require discipline when adding new features.

## Follow-up

- Keep new infrastructure concerns behind ports.
- Add adapter-level integration tests for boundary behavior.
- Revisit auth token storage backend if deployment moves to multi-instance setup.
