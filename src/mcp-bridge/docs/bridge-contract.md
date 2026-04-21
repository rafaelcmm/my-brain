# MCP Bridge Behavior Contract

This document captures the existing runtime behavior of the bridge in `src/index.mjs` before TypeScript refactor.

## Runtime Defaults

- `MYBRAIN_REST_URL`: defaults to `http://127.0.0.1:8080`
- `MYBRAIN_UPSTREAM_MCP_COMMAND`: defaults to `npx`
- `MYBRAIN_UPSTREAM_MCP_ARGS`: defaults to `-y ruvector mcp start`
- `MYBRAIN_INTERNAL_API_KEY`: defaults to empty string
- `MYBRAIN_PROMETHEUS_PORT`: defaults to `9090`

## Tool Surface

Bridge always exposes:

1. `hooks_capabilities`
2. `mb_context_probe`
3. `mb_remember`
4. `mb_recall`
5. `mb_vote`
6. `mb_forget`
7. `mb_session_open`
8. `mb_session_close`
9. `mb_digest`

Legacy passthrough allowlist:

- `hooks_stats`

## `listTools` Behavior

1. Start with all bridge tools.
2. Fetch capabilities.
3. If upstream connected, merge upstream tools only when:
   - tool name is in allowlist; and
   - if `engine=false`, reject upstream tools with `brain_` prefix.
4. Skip duplicates by name.
5. Increment `mb_bridge_tools_list_total`.
6. Increment `mb_bridge_tools_filtered_total{tool=...}` for each filtered upstream tool.

## `callTool` Behavior Matrix

### Engine gate

- If `engine=false` and tool name starts with `brain_`:
  - return `{success:false,error:"engine_disabled",...}`
  - increment `mb_bridge_tool_calls_total{tool=...,status="blocked"}`

### Bridge tools

- `hooks_capabilities` -> `GET /v1/capabilities` compatibility envelope
- `mb_context_probe` -> `POST /v1/context/probe`
- `mb_remember` -> `POST /v1/memory`
  - increments `mb_remember_total` when `success===true`
  - increments `mb_dedup_hits_total` when `deduped===true`
- `mb_recall` -> `POST /v1/memory/recall`
  - observes histogram `mb_bridge_recall_latency_ms`
  - increments `mb_recall_total{result=hit|miss}`
- `mb_vote` -> `POST /v1/memory/vote`
- `mb_forget` -> `POST /v1/memory/forget`
  - increments `mb_forget_total{mode=...}` when `success===true`
- `mb_session_open` -> `POST /v1/session/open`
- `mb_session_close` -> `POST /v1/session/close`
- `mb_digest` -> `POST /v1/memory/digest`

### Unknown tool

1. If upstream connected and name in allowlist, passthrough using upstream `callTool`.
2. Otherwise return `{success:false,error:"unsupported_tool",...}` and increment error metric.

## Capabilities Caching

- Cache key: full capabilities object only.
- TTL: `10000 ms`.
- On fetch failure:
  - `getCapabilities` returns cached value or `{}`.
  - `getCapabilitiesPayload` returns fallback envelope with:
    - `success:false`
    - `degradedReasons:["capabilities_unavailable"]`

## Metrics Endpoint

- HTTP server listens on `0.0.0.0:${MYBRAIN_PROMETHEUS_PORT}` when port > 0.
- `GET /metrics` requires `x-mybrain-internal-key`.
- Authorization uses constant-time equality with exact byte length match.
- Missing key, wrong key, or empty configured key returns `401 unauthorized`.
- Success returns Prometheus text payload and `200`.
- Other paths return `404 not found`.

## Orchestrator REST behavior

- Adds `x-mybrain-internal-key` when configured.
- `callOrchestrator` always returns object with `http_status` and parsed JSON body fields.
- If response body invalid JSON, returns `{http_status,success:false,error:"invalid_response"}`.

## Startup Sequence

1. Optionally start metrics HTTP server.
2. Attempt upstream stdio connect; continue even if failure.
3. Connect MCP stdio server.
4. Emit ready log: `[my-brain] bridge stdio server ready`.
