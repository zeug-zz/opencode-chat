## Context

The opencode server emits fine-grained streaming events for reasoning/thinking content:
- `session.next.reasoning.started` — reasoning has begun
- `session.next.reasoning.delta` — incremental text chunk (fires repeatedly)
- `session.next.reasoning.ended` — reasoning complete, full text

The TUI handles all three, producing smooth token-by-token CoT display. The GUI's `AgentEvent` union in `domain.ts` excludes these events. They arrive at runtime through the `as unknown as AgentEvent` cast in `mappers.ts` but are silently dropped.

The GUI currently only handles `message.part.updated` with `part.type === "reasoning"`, which fires once with the completed `ReasoningPart` (with `time.end` set and full accumulated text). The `ReasoningPartView` component renders this as a collapsible "Thought" block showing a spinner while `time.end` is absent and the full text when complete — but since no partial updates arrive, it always shows blank+batch.

## Goals / Non-Goals

**Goals:**
- Stream reasoning text into the GUI in real time, matching TUI behavior
- Show reasoning text during active thought (spinner replaced by growing text)
- Auto-expand the reasoning block while the model is thinking
- Keep existing `ReasoningPartView` component structurally unchanged

**Non-Goals:**
- Token-by-token animation or typing effects (text arrives in chunks from the server)
- Tool input streaming (`session.next.tool.input.delta`) — out of scope
- Text content streaming (`session.next.text.delta`) — already handled via `message.part.updated`
- Any changes to the opencode server or SDK

## Decisions

### Decision 1: Accumulate deltas in `useMessages` hook

**Chosen**: Add a `Map<reasoningID, string>` delta buffer inside `useMessages.ts`, upsert `ReasoningPart` objects on each delta.

**Rationale**: Reasoning parts live inside the message parts array managed by `useMessages`. Splitting delta accumulation into a separate hook would require cross-hook synchronization (the new hook would need to mutate the messages array owned by `useMessages`). Keeping it in the same hook avoids this complexity.

**Alternative considered**: A separate `useReasoning` hook that exposes a separate data structure. Rejected — would require `MessageItem` to merge two data sources, adding fragility.

### Decision 2: Use in-progress `ReasoningPart` without `time.end`

**Chosen**: On `reasoning.started`, create a `ReasoningPart` with `text: ""` and no `time.end`. On each `delta`, upsert the part with accumulated text (still no `time.end`). On `ended`, upsert with full text and `time.end` stamp.

**Rationale**: The existing `ReasoningPartView` already uses `!!part.time?.end` to decide spinner vs. content. Creating parts with that field absent makes them render the spinner + available text — no component changes needed.

### Decision 3: Auto-expand during active reasoning

**Chosen**: Change `useState(false)` to `useState(!isComplete)` in `ReasoningPartView`.

**Rationale**: Users should see CoT streaming without manual toggle. The `expanded` state still persists across re-renders for the same part, so once a user manually collapses it, it stays collapsed even as new deltas arrive. When reasoning completes, the block returns to collapsed default.

### Decision 4: Collapsed by default (revised from auto-expand)

**Chosen**: Revert `useState(!isComplete)` back to `useState(false)`.

**Rationale**: User preference — keep reasoning collapsed by default. Users manually expand to check CoT progress during long pauses. Auto-expand was intrusive for users who don't always want to see CoT.

### Decision 5: V2Event format normalization (post-investigation fix)

**Context**: After initial implementation, runtime testing revealed that reasoning deltas don't stream. Investigation found the SDK `Event` union includes both v1-style events (`{ type, properties }`) and v2-style events (`{ type, data }`). The server may emit reasoning events in V2Event format with `data`, but all GUI code accesses `event.properties`. The `mapEvent()` function's blind `as unknown as AgentEvent` cast hides this mismatch at compile time. At runtime, `event.properties` is `undefined` for V2Event-format events, causing a silent `TypeError` in the event handler that React swallows.

**Chosen**: Normalize V2Event format to v1 format in `mapEvent()`. If an event has `data` but not `properties`, copy `data` to `properties`.

**Rationale**: This is the minimal, safe fix that handles both formats. All downstream code continues to use `event.properties`. No changes needed in hooks or components.

**Alternative considered**: Change all downstream code to access `event.data ?? event.properties`. Rejected — touches too many files and is fragile.

### Decision 6: Endpoint switch fallback (Phase 2)

**Context**: The TUI uses `sdk.global.event()` → `/global/event` endpoint. The GUI uses `client.event.subscribe()` → `/event` endpoint. These are different server endpoints. The `/event` endpoint might not emit non-durable live events like `session.next.reasoning.delta`.

**Chosen**: If Phase 1 (format normalization) doesn't fix streaming, switch to `/global/event` endpoint. The `/global/event` stream wraps events as `{ payload, directory, workspace }`, so unwrap `event.payload` in the stream loop.

**Rationale**: The TUI successfully streams reasoning via `/global/event`. Matching the TUI's endpoint eliminates endpoint-level differences as a variable.

## Risks / Trade-offs

- **High delta frequency may cause React re-renders on every chunk**: The server sends deltas in small chunks. React's batching (React 18) mitigates this, but if perf becomes an issue, a `requestAnimationFrame` debounce can be added.
- **Reasoning events may arrive without a preceding `message.updated`**: The `upsertPart` function requires the parent message to exist in the array. If a `reasoning.started` arrives before the message is created, the part is silently skipped. Mitigation: the delta handler checks for existing message before upserting, and retries on next delta.
- **Session filtering**: Like other hooks in this codebase, deltas MUST be filtered by active session ID to prevent event bleed when multiple sessions run in parallel.
- **V2Event format mismatch**: The server may emit events in V2Event format (`{ type, data }`) instead of v1 format (`{ type, properties }`). The `mapEvent()` normalizer handles this, but if other event types also arrive in V2Event format, they would need the same treatment.
- **Endpoint difference**: The `/event` endpoint may not emit non-durable live events. The `/global/event` fallback adds a `{ payload }` unwrapping layer.
