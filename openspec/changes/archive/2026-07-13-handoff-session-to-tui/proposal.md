## Why

“Open session in terminal” currently forks on the **companion** OpenCode server and attaches TUI there. That keeps Scout overlay / chat server coupling and is slow or silent-fails. For planning and full build agent work, users need a **full independent TUI** while the **chat companion stays running**.

## What Changes

- Replace default terminal handoff with **export → independent TUI import** while companion remains connected.
- Export session snapshot via the companion client (no second writer on the project DB for export when possible).
- Launch VS Code terminal running independent `opencode import` + full TUI continue (or equivalent), not `attach` as primary.
- On project DB lock / independent start failure: clear error + **optional attach fallback** (same companion session, not silent hang).
- Terminal reliability: progress, visible errors, absolute `opencode` path, shell-ready before `sendText`.
- Do **not** stop/kill the companion server as part of handoff.
- Do **not** write `opencode.json` for this flow.

**Non-goals:**
- Live bidirectional sync after handoff (copy parity only).
- Stopping companion to free DB.
- Changing Scout overlay semantics.

## Capabilities

### New Capabilities
- `session-tui-handoff`: Export active chat session and open an independent full TUI on a copy, with chat remaining up.

### Modified Capabilities
- None (terminal open behavior is an implementation of handoff, not a prior main-spec capability).

## Impact

- Host: `chat-view-provider.ts` openTerminal path; platform terminal launcher
- Agent: export session snapshot helper
- Webview: optional copy/title for handoff button
- Compatibility: companion stays up; fallback attach if independent start fails
- Tests: fork-on-companion openTerminal tests rewritten for handoff
