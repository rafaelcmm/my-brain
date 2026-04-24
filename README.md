# 🧠 my-brain

> **Your local AI assistants, finally with a memory.**

my-brain is a self-hosted memory and orchestration layer for MCP-compatible clients like **Claude Code**, **Cursor**, and **VS Code Copilot Chat**. Runs locally on Docker Compose, guards every request with bearer auth, and exposes a single MCP endpoint your tools can connect to.

---

## ✨ Features

- 🧠 **Durable memory** that survives editor sessions — your AI remembers decisions, bugs, conventions, and context across projects.
- 🔌 **One MCP endpoint** at `/mcp` (spec 2024-11-05+) — point Claude Code, Cursor, or any MCP client at it and you're in.
- 🖥️ **Web dashboard** — browse memories, run queries, explore the knowledge graph, manage CRUD from a Next.js UI.
- 🔐 **Secure by default** — localhost bind, bearer token auth, CSRF-protected web sessions, rotatable secrets.
- 🐳 **Single-command setup** — Docker Compose brings up Postgres, orchestrator, MCP bridge, Ollama, and web.
- 🤖 **Ships with an LLM** — bundles Ollama + Qwen so memory ranking and summarization work out of the box.
- 🧪 **Postman collection** for instant sanity checks.
- 🚀 **CI/CD templates** — tag-driven releases, GHCR publishing, compose validation.

---

## 🚀 Quick Start

### Clone and install

```bash
git clone https://github.com/rafaelcmm/my-brain.git
cd my-brain
./src/scripts/install.sh
```

The installer generates a bearer token in `.secrets/auth-token`, writes a working `.env`, and starts the stack.

### Or, one-line bootstrap from a release

```bash
curl -fsSL https://raw.githubusercontent.com/rafaelcmm/my-brain/v0.1.0/src/scripts/install.sh | bash
```

Replace `v0.1.0` with the release tag you want.

### Daily commands

```bash
docker compose up -d           # start everything
docker compose ps              # check services
docker compose logs -f         # tail logs
docker compose down            # stop
./src/scripts/smoke-test.sh    # quick health check
```

💡 **No NVIDIA GPU?** Use `pnpm run docker:up:cpu` for CPU fallback.

---

## 📋 Prerequisites

- 🐳 Docker Engine with the `compose` plugin
- 📦 git
- 🔐 openssl
- 🌐 curl

---

## 🖥️ Web Dashboard

Once the stack is up, open:

👉 **http://127.0.0.1:3000**

Sign in using the bearer token from `.secrets/auth-token`. The web UI gives you:

- 📊 **Dashboard** — memory totals, learning stats, top tags
- 📚 **Memories** — browse, filter, view, delete entries
- ✍️ **New memory** — Markdown editor with live preview
- 🔍 **Query runner** — call `mb_recall`, `mb_digest`, `mb_search` with a latency envelope
- 🕸️ **Graph explorer** — visualize how memories relate by shared repo and tags

Browser only ever sees an httpOnly `session` cookie — your bearer token is never stored client-side.

---

## 🔌 Connect an MCP Client

Copy `.mcp.json.example` into your client config. Recommended header form uses an env var:

```json
{
  "mcpServers": {
    "my-brain": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MYBRAIN_TOKEN}"
      }
    }
  }
}
```

Then export the token in your shell profile:

```bash
export MYBRAIN_TOKEN="$(cat ~/.my-brain/.secrets/auth-token)"
```

---

## 📚 Documentation

| Topic | Location |
| --- | --- |
| 🏗️ Architecture and components | [docs/technical/architecture.md](docs/technical/architecture.md) |
| 📖 API reference and env vars | [docs/technical/reference.md](docs/technical/reference.md) |
| ⚙️ Configuration guide | [docs/technical/configuration.md](docs/technical/configuration.md) |
| 🔐 Security model | [docs/technical/security.md](docs/technical/security.md) |
| 🛠️ Runbook, troubleshooting, Postman | [docs/runbooks/local-operations.md](docs/runbooks/local-operations.md) |

---

## 🤝 Contributing

1. Keep changes scoped and documented.
2. Run the standard checks:
   ```bash
   pnpm install
   pnpm lint
   pnpm test
   pnpm format:check
   ```
3. Validate compose + smoke flow before opening a PR.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for a readable history.

---

## 📦 Releases

Releases are generated from pushed git tags matching `v*` (example: `v0.2.0`). The tag-triggered
workflow publishes multi-arch images to GHCR and attaches a release bundle.

---

## 🧭 Status

Current baseline is **bootstrap-quality**, designed for local-first deployments. The full stack is
the only supported runtime profile. Internet or team exposure still requires TLS, a stronger auth
model, and a hardened rate-limiting layer.

---

## 📄 License

[MIT](LICENSE.md)
