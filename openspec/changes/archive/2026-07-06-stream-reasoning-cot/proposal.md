## Why

The GUI's reasoning/thinking display shows a blank "Thinking…" spinner until the model finishes reasoning, then dumps the full text at once. The opencode TUI streams CoT text token-by-token via `session.next.reasoning.delta` events, providing visibility into model progress during long-running queries. The GUI ignores these events entirely — it only reacts to `message.part.updated` which fires once with the completed `ReasoningPart`.

## What Changes

- Add `session.next.reasoning.started`, `session.next.reasoning.delta`, and `session.next.reasoning.ended` to the `AgentEvent` union in `packages/core/src/domain.ts`
- Add a delta-accumulation handler in `useMessages.ts` that builds in-progress `ReasoningPart` objects from streaming deltas and upserts them into the message parts array
- Wire the new event types through `App.tsx`'s `handleEvent` dispatch into `handleMessageEvent`
- When reasoning is in-progress (no `time.end`), the part renders with the spinner + streaming text; the existing `ReasoningPartView` component handles this already
- Auto-expand the reasoning block during active streaming so users see the CoT without manual toggle

## Capabilities

### New Capabilities

- `reasoning-streaming`: Real-time chain-of-thought text display in the GUI during model reasoning, matching TUI behavior

### Modified Capabilities

_None — no existing spec covers reasoning display behavior._

## Impact

- **Core domain types**: `packages/core/src/domain.ts` — 3 new `AgentEvent` variants
- **Webview hooks**: `packages/platforms/vscode/webview/hooks/useMessages.ts` — new delta accumulation state and event handlers
- **Webview app**: `packages/platforms/vscode/webview/App.tsx` — wire new events into `handleMessageEvent`
- No API changes, no dependency changes, no breaking changes
