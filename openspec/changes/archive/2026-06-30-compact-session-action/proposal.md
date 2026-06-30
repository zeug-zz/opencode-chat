## Why

The Agents selector currently exposes `compact` as if it were a normal primary chat agent, but selecting it sends chat prompts to the `compaction` agent instead of invoking opencode's session compaction API. Users need a GUI affordance that performs real session compaction from the chat view without switching to the TUI.

## What Changes

- Replace the selectable `compaction` primary-agent entry with a one-shot `compact` action in the Agents menu.
- Keep the selectable primary-agent menu behavior for `chat` (`plan`) and `build`.
- Invoke the existing `compressSession` UI-to-host protocol when the user clicks `compact`.
- Preserve the currently selected primary agent before and after compaction.
- Keep session compaction scoped to the active session and current selected model.

## Capabilities

### New Capabilities
- `session-compaction-ui`: Covers triggering real opencode session compaction from the VS Code chat GUI.

### Modified Capabilities
- `primary-agent-selection`: Clarifies that `compact` is an action in the Agents menu, not a selectable primary agent.

## Impact

Affected areas:
- Webview UI: `AgentSelector`, `InputArea`, and `App` callback plumbing.
- Existing protocol path: `compressSession` from webview to extension host.
- Tests: focused initialization/menu tests and host/webview assertions as needed.

Compatibility:
- Existing `chat`/`build` selection and send payload behavior must remain unchanged.
- No backend protocol changes are required because `compressSession` and `summarizeSession` already exist.
- No destructive migration is needed.

Scope:
- In scope: GUI menu behavior, callback plumbing, and tests.
- Non-goals: implementing TUI slash-command parsing, changing opencode agent definitions, adding new backend APIs, or changing session summarization internals.

Risks and fallback:
- Risk: Users may expect `compact` to remain selected after clicking it. Mitigation: keep it visually as an action row and preserve the existing selected primary agent label.
- Risk: Compaction failures may be silent because the existing host handler does not emit a specific UI result. Mitigation: this change only wires the existing API path; richer progress/error UX can be a follow-up.
- Fallback: restore the prior `chat`/`build` selector behavior by removing the compact action row without altering protocol code.
