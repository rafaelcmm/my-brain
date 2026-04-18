# docs

Technical documentation index for `my-brain`.

## Architecture

- Hexagonal architecture ADR: `architecture/adr-001-hexagonal-mcp-brain.md`
- Core remains framework-agnostic: domain + ports + use-cases
- MCP server acts as inbound adapter
- Embeddings, adaptive brain, and auth persistence are outbound adapters

## Project Structure

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
    outbound/security/
    outbound/sona/
  shared/config/
  composition/
  cli/
```

## Runtime and Quality References

- Source-level contracts and runtime behavior: `../src/README.md`
- Release workflow, hardening, and install paths: `../release/README.md`
- Production operator runbook: `../release/INSTALL.md`
- Example MCP client and rule/skill samples: `../examples/README.md`
