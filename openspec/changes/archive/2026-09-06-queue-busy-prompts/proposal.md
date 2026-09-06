## Why

Prompts entered while Chat or Write is generating are currently discarded because `InputArea` ignores Enter while busy. This loses user work and makes Stop unable to behave like an interrupting TUI queue; a host-owned FIFO queue is needed now to preserve complete prompts without coupling the extension to the newer OpenCode delivery API.

## What Changes

- Admit normal `sendMessage` submissions while a session is busy or has a just-admitted active send into an in-memory, per-session FIFO queue.
- Preserve each queued message's complete existing payload, including model, effort, files, selected agents, skills, commands, and system overrides.
- Serialize host dispatches with an active-send guard and drain exactly one queued prompt on the matching `session.status: idle` event.
- Keep queued prompts through abort; Stop remains an interrupt and the abort-caused idle transition performs the normal drain.
- Publish a typed host-to-webview queued count and render a compact localized `Queued: N` indicator near the input controls.
- Remove the busy-Enter no-op while preserving IME handling, the Send/Stop switch, attachments, model/effort selection, command behavior, and both Chat and Write modes.
- Clear queues when sessions are deleted and scope status/events so session switches or foreign events cannot retarget queued work.
- Add focused host and webview regression coverage for FIFO ordering, payload preservation, idle/abort sequencing, session isolation, deletion, failure handling, and localization.

## Capabilities

### New Capabilities

- `prompt-queue`: Host-owned FIFO delivery of prompts submitted while a Chat or Write session is active, with session-scoped queue status and UI feedback.

### Modified Capabilities

None. Existing session-navigation and primary-agent requirements remain unchanged; this change adds session-scoped queue coordination without changing their contracts.

## Impact

- Affected host routing and lifecycle handling in `ChatViewProvider`, the shared core host-to-webview protocol, `App`, `InputArea`, its CSS, all supported locale files, and focused host/webview scenarios.
- No OpenCode SDK upgrade, native delivery-field dependency, persistence migration, config-file write, agent permission change, sandbox change, MCP change, or TUI change.
- Queue contents are intentionally in-memory and are discarded on extension restart; existing send and error contracts remain in use. If a dispatch fails, the active guard is released without silently dropping the failed payload, allowing the existing error path to remain visible and preventing implicit advancement.
- The fallback is to remove the queue coordinator, count message, indicator, locale keys, and focused tests and restore the current busy-Enter no-op/direct forwarding behavior; no persisted data rollback is required.
