---
name: my-brain-session
description: Automatically invoked to open and close tracked sessions in my-brain so SONA learns from trajectories, not isolated calls. Opens on first message or after inactivity gaps. Closes on explicit completion cues like "done", "shipped", "that's all", or prolonged idle periods.
allowed-tools: mcp__my-brain__mb_context_probe, mcp__my-brain__mb_session_open, mcp__my-brain__mb_session_close
---

# my-brain Session Management

1. Open session with `mb_session_open` when no active session exists.
2. Pass `agent` and `context` from `mb_context_probe`.
3. Cache `session_id` internally.
4. Close with `mb_session_close` on completion cues and include `success/quality` when available.
5. Keep session ids internal and invisible to user-facing output.
