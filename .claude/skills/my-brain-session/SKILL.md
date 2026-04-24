---
name: my-brain-session
description: Automatically invoked to open and close tracked sessions in my-brain so SONA learns from trajectories, not isolated calls. Opens on first message or after inactivity gaps. Closes on explicit completion cues like "done", "shipped", "that's all", or prolonged idle periods.
---

# my-brain Session Management

1. Call `mb_context_probe` before opening or closing session state.
2. Open session with `mb_session_open` when no active session exists.
3. Pass `agent` and `context` from `mb_context_probe`.
4. Cache `session_id` internally.
5. Close with `mb_session_close` on completion cues and include `success/quality` when available.
6. Keep session ids internal and invisible to user-facing output.

## Good Example

1. First non-trivial turn opens one session after probe; "done" cue closes same session id.

## Bad Example

1. Opening new session every user message without checking active session cache.
