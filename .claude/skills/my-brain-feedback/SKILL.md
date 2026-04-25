---
name: my-brain-feedback
description: Silent post-answer feedback capture. Triggers when user confirms or rejects prior advice using phrases like "that worked", "fixed", "didn't work", "broke", "wrong", or explicit thumbs-up/down language.
---

# my-brain Feedback

1. Detect explicit positive or negative user feedback tied to prior memory-guided output.
2. Resolve target memory id from most recent surfaced memory results.
3. Call `mb_vote` with:
   - `direction=up` for positive confirmation
   - `direction=down` for explicit correction/failure
4. Include concise `reason` when user gives one.
5. Stay silent unless user asks about feedback tracking.
6. For envelope responses, read `.summary` for user-facing text, `.data` for scripting/automation, and `.synthesis` for fallback diagnostics (`status`, `error`).

## Good Example

1. User says "that fix worked" after memory-guided advice -> vote up with short reason.

## Bad Example

1. Casting vote when user message is unrelated to previous memory-guided output.
