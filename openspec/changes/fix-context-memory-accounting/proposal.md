## Why

The context-memory chip currently reports cumulative prompt work across multiple
LLM steps instead of the size of the current context window. Multi-step tool use
can therefore make a normal session appear to be at 100% while the same session
shows substantially lower usage in the OpenCode TUI.

## What Changes

- Replace cumulative `step-finish` token accounting with a latest-context snapshot.
- Use one current assistant message or step token snapshot for the chip, using the
  project-defined prompt-context calculation (`input + cache.read`).
- Preserve server-provided `session.next.context.updated` text as the preferred
  display source when it is non-zero.
- Stop using cumulative session token totals as the current-context fallback.
- Ensure repeated updates and multi-step tool calls do not add the same context
  repeatedly.
- Preserve active-session filtering and clear/repopulate the chip across
  compaction and session changes.
- Add regression coverage for multiple assistant messages, repeated step events,
  compaction, zero values, and the model-limit percentage calculation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-memory`: Define the chip as current context-window occupancy derived
  from the latest valid snapshot, not cumulative session token usage.

## Impact

- `packages/platforms/vscode/webview/App.tsx`: context snapshot selection and
  formatting state.
- `packages/platforms/vscode/webview/__tests__/scenarios/`: regression tests for
  context accounting and compaction behavior.
- `openspec/specs/context-memory/spec.md`: clarify snapshot, source-priority,
  and cumulative-session exclusions.
- No host protocol, SDK mapper, or public API changes are expected.

## Scope and Non-goals

- In scope: the context-memory display value and its event/state fallbacks.
- Out of scope: changing OpenCode server token accounting, model metadata, TUI
  behavior, cost reporting, or the visual design of the chip.
- The existing `ChatSession.tokens` field remains available for session-level
  usage data; this change only prevents it from being interpreted as current
  context occupancy.

## Risks, Fallback, and Compatibility

The token fields vary by provider and may be absent while a response is in
progress. The display will retain the last valid value when a fallback contains
zero or incomplete data, and will remain empty until a valid snapshot arrives.
Server-provided context text remains authoritative when available. If no server
text or valid token snapshot is available, the extension continues operating
without a context percentage.

This is a corrective display change and is not breaking for the event or protocol
contracts. Existing sessions, persisted state, independent TUI behavior, and
OpenCode configuration remain unchanged.
