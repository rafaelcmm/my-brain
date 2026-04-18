# my-brain

`my-brain` is self-hosted MCP memory server with adaptive learning, semantic retrieval, and explainable evidence output.

## Functionality

- MCP tools: `query`, `inspect_interaction`, `feedback`, `learn`
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2` via `@xenova/transformers`
- Adaptive learning engine: `@ruvector/sona`
- Persistent vector memory: `@ruvector/core`

## Prerequisites

- Node.js >= 22
- Corepack-enabled Yarn 1.22.x
- Docker Engine 24+ and Docker Compose v2 (for container runtime)

## Install

Local setup:

```bash
corepack enable
yarn install --frozen-lockfile
```

Pinned release installer example (fixed URL pattern; works for `v1.0.3`):

```bash
MY_BRAIN_VERSION="v1.0.3"; \
curl -fsSL "https://raw.githubusercontent.com/rafaelmonteiro/my-brain/${MY_BRAIN_VERSION}/release/install.sh" \
  | MY_BRAIN_VERSION="${MY_BRAIN_VERSION}" bash
```

Generic pinned version:

```bash
MY_BRAIN_VERSION="vX.Y.Z"; \
curl -fsSL "https://raw.githubusercontent.com/rafaelmonteiro/my-brain/${MY_BRAIN_VERSION}/release/install.sh" \
  | MY_BRAIN_VERSION="${MY_BRAIN_VERSION}" bash
```

Release bundle and operations runbook:

- `release/INSTALL.md`
