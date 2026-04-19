---
name: my-brain-session
description: Automatically invoked to open and close tracked sessions in my-brain so SONA learns from trajectories, not isolated calls. Opens on first message or after inactivity gaps. Closes on explicit completion cues like "done", "shipped", "that's all", or prolonged idle periods.
allowed-tools: mcp__my-brain__session_start, mcp__my-brain__session_end
---

# my-brain Session Management

1. Open session when no active session exists.
2. Use derived session id from timestamp and first message hash.
3. Close session when work completion is detected.
4. Keep session ids internal and invisible to user-facing output.
