## Context

opencode-chat's SSE pipeline is:

```
SDK SSE stream → mapEvent (blind cast) → agent.onEvent listeners
  → chat-view-provider: postMessage({ type: "event", event })
  → webview: handleEvent → per-hook dispatch
```

The SDK `Event` union includes `EventSessionNextContextUpdated`:

```ts
{
  type: "session.next.context.updated";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    text: string;  // e.g. "134.6K (28%)"
  };
}
```

The domain's `AgentEvent` union does NOT include it. The `mapEvent` function (`mappers.ts:81-83`) is a blind cast (`event as unknown as AgentEvent`), so the event passes through at runtime but is not type-checked or handled. Adding the variant to `AgentEvent` makes it flow to the webview where it can be consumed.

The InputArea's `actionsLeft` bar (line 799) currently renders: `ModelSelector → AgentSelector → Settings gear → Terminal button`. The context memory chip is appended after the terminal button, using the existing flexbox `gap: 4px` layout.

## Goals / Non-Goals

**Goals:**
- Display the server-provided contextual memory string in the InputArea's action bar.
- Zero new protocol messages — reuse the existing SSE event channel.
- Ephemeral display (resets on session switch or webview remount).

**Non-Goals:**
- Persistence across webview sessions.
- Parsing or formatting the `text` field from `context.updated` (rendered as-is when available).

## Decisions

### Decision 1: Add `session.next.context.updated` to `AgentEvent` (not a new message type)

Adding to the existing `AgentEvent` union is the minimal path. The event already flows through `mapEvent` (runtime-compatible blind cast) and `chat-view-provider.postMessage`. No mappers, agent, or host changes needed.

Alternatives considered:
- New `HostToUIMessage` type like `{ type: "contextMemory", text: string }` — rejected because it requires changes to the agent interface, host message handler, and protocol types for data that already arrives via events.
- Client-side computation from `ChatMessage.tokens` + `ModelInfo.limit.context` — rejected because it requires threading model limit info and summing across all messages, with no guarantee of matching the server's own accounting.

### Decision 2: Ephemeral state in App.tsx (no persistence)

`contextMemory` is a simple `useState<string>("")` in App.tsx, reset on each webview mount. This matches the server's semantics: the value is transient stream metadata, not session state.

Alternatives considered:
- Persisting in `UIPersistedState` — rejected because the value is stale immediately on next event and has no meaning across webview restarts.
- Dedicated `useContextMemory` hook — rejected as overkill for a single `useState` + one event handler branch.

### Decision 3: Render the `text` field as-is (no parsing)

The TUI displays the same server-provided string. Parsing client-side would couple the GUI to server formatting internals and provide no value over raw display.

### Decision 4: Chip placement after terminal button in `actionsLeft`

The terminal button is the rightmost existing `actionsLeft` element. Placing the chip after it keeps the layout natural — model/agent/settings on the left, session tools on the right. The chip uses the same muted color (`--vscode-descriptionForeground`) as other secondary UI elements.

### Decision 5: Fallback computation from `session.next.step.ended`

Testing revealed that the opencode server does not emit `session.next.context.updated` during normal chat sessions. The event exists in the SDK type system but the server only emits it in specific code paths (likely compaction or TUI-internal flows). The pipeline is correctly wired — the event simply never arrives.

The `session.next.step.ended` event IS emitted on every LLM response completion. Its `tokens` field carries `{ input, output, reasoning, cache: { read, write } }`. The `input` field represents the total prompt tokens for that step (the full context window sent to the model), and `cache.read` represents cached prompt tokens that are still in the context window. The sum `input + cache.read` approximates the total context window usage.

The fallback computes: `contextTokens = tokens.input + tokens.cache.read`, then divides by the selected model's `limit.context` (available from provider metadata already in scope via `prov.providers`) to produce a percentage. The display format matches the TUI convention: `"134.6K (28%)"`.

Both event handlers coexist: `context.updated` (primary, if the server ever emits it) and `step.ended` (fallback, always works). Both write to the same `contextMemory` state. If both fire, the last one wins — which is correct since `step.ended` fires on response completion and `context.updated` would fire at a different point in the lifecycle.

Alternatives considered:
- Polling `GET /api/session/{sessionID}/context` REST endpoint — rejected because it adds latency and server load for data already available via events.
- Client-side sum of all message tokens — rejected because `step.ended` already provides the server's own total, which is more accurate than summing individual message token counts (the server accounts for system prompts, tool definitions, and other context overhead that individual message tokens don't include).

## Risks / Trade-offs

- The event fires server-side during streaming and may update frequently. React 18 batching handles this; the chip is a single `<span>` with no virtual DOM overhead.
- If the server changes the `text` format, the GUI displays the new format automatically (no parsing dependency).
- The chip may be empty between session switches — the state clears when the active session id doesn't match the event's `sessionID`.

## Migration Plan

1. Add the `AgentEvent` variant in `domain.ts`.
2. Add `contextMemory` state + `handleEvent` branch + prop threading in `App.tsx`.
3. Add `contextMemoryText` prop + conditional render in `InputArea.tsx`.
4. Add CSS for `.contextMemory`.
5. Add locale key to all eight files.
6. Add scenario test and InputArea component test.
7. Run `npm run check && npm test && npm run build`.

Rollback path:
- Remove the `AgentEvent` variant, the App state/handler/prop, the InputArea prop/render, the CSS rule, and the locale key. All changes are additive — no existing code paths are modified.

## Implementation Notes

- The existing `handleEvent` already filters by `activeSessionRef.current?.id` for `file.edited` and `todo.updated`. Follow the same pattern for `session.next.context.updated`.
- The `contextMemory` state should clear when the active session changes: add a `useEffect` that resets it when `session.activeSession?.id` changes, or simply clear it in the `activeSession` case of the message listener.
- The chip is conditionally rendered: `{contextMemoryText && <span className={styles.contextMemory}>{contextMemoryText}</span>}`.
- CSS: `.contextMemory { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; user-select: none; }`.
