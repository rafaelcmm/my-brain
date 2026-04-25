---
name: my-brain-session
description: Automatically invoked to open and close tracked sessions in my-brain so SONA learns from trajectories, not isolated calls. Opens on first message or after inactivity gaps. Closes on explicit completion cues like "done", "shipped", "that's all", or prolonged idle periods.
---

# my-brain Session Management

1. Call `mb_context_probe` before opening or closing session state.
2. Cache normalized probe context for the whole session (`repo`, `project`, `language`, `source`, `author`).
3. Normalize blanks and apply fallback before open/close metadata usage:
   - `repo`: `context.repo || context.repo_name || "unknown-repo"`
   - `project`: `context.project || "unknown"`
   - `language`: `context.language || "unknown"`
   - `source`: `context.source || "agent"`
   - `author`: `context.author || "unknown"`
4. Open session with `mb_session_open` when no active session exists and always send non-empty `agent` identity.
5. Cache `session_id` internally.
6. Close with `mb_session_close` on completion cues and include `success/quality` when available.
7. Keep session ids internal and invisible to user-facing output.

## Good Example

1. First non-trivial turn probes context once, normalizes/fills identity fields, opens one session, and closes same session id on "done" cue.

## Bad Example

1. Re-probing every message without reusing cached normalized context, causing null/blank metadata drift.
