## 1. Core Domain Types

- [x] 1.1 Add `session.next.reasoning.started`, `session.next.reasoning.delta`, and `session.next.reasoning.ended` to the `AgentEvent` union in `packages/core/src/domain.ts`. Each event type has a `type` discriminator and `properties` object matching the SDK field names: `sessionID`, `assistantMessageID`, `reasoningID`; plus `delta` (string) for delta events and `text` (string) for ended events.

## 2. Hook Implementation

- [x] 2.1 Add a `reasoningBuffers: Map<string, string>` ref to `useMessages.ts`, keyed by `reasoningID`. On `session.next.reasoning.started`, upsert a `ReasoningPart` into the message's parts array with `text: ""`, no `time.end`, `reasoningID` in the `id` field. On `session.next.reasoning.delta`, accumulate the `delta` string into the buffer, then upsert the `ReasoningPart` with the accumulated text (still no `time.end`). On `session.next.reasoning.ended`, upsert the `ReasoningPart` with the final `text` and `time.end: Date.now()`. All three handlers MUST filter by active session ID before processing.

- [x] 2.2 Handle the edge case where `reasoning.*` events arrive before the parent `message.updated` event: guard with a check that the message exists in the parts array before upserting. If the message doesn't exist yet, skip the delta (the next delta will retry).

## 3. App.tsx Wiring

- [x] 3.1 Add active session ref parameter to `useMessages.handleMessageEvent` so reasoning events can be filtered by the currently active session ID. Update the `handleMessageEvent` function signature and the call site in `App.tsx`'s `handleEvent`.

- [x] 3.2 Add `case "session.next.reasoning.started"`, `case "session.next.reasoning.delta"`, and `case "session.next.reasoning.ended"` arms to the switch in `handleMessageEvent` to route these events to the new handlers.

## 4. UI Auto-Expand

- [x] 4.1 In `ReasoningPartView` (`packages/platforms/vscode/webview/components/organisms/MessageItem/MessageItem.tsx`), change `useState(false)` to `useState(!isComplete)` so the reasoning block auto-expands when thinking is active (no `time.end`).

- [x] 4.2 Revert auto-expand back to `useState(false)` per user preference — reasoning blocks stay collapsed by default. Users manually expand to check CoT progress.

## 5. Tests

- [x] 5.1 Add unit tests for delta accumulation in `packages/platforms/vscode/webview/__tests__/hooks/useMessages.test.ts` covering: a) `reasoning.started` creates empty part, b) `reasoning.delta` accumulates text, c) `reasoning.ended` sets `time.end`, d) deltas ignored for inactive session, e) deltas ignored when parent message doesn't exist yet.

- [x] 5.2 Add a scenario test in `packages/platforms/vscode/webview/__tests__/scenarios/` for the full streaming reasoning flow.

## 6. Post-Investigation Fix: V2Event Format Normalization

- [x] 6.1 In `packages/agents/opencode/src/mappers.ts`, update `mapEvent()` to normalize V2Event format. If an event has `data` but not `properties`, copy `data` to `properties` so all downstream code can uniformly access `event.properties`. This handles the case where the server emits reasoning events in V2Event format (`{ type, data }`) while the GUI expects v1 format (`{ type, properties }`).

- [x] 6.2 Add a unit test for `mapEvent()` format normalization: a) v1 event with `properties` passes through unchanged, b) v2 event with `data` gets `data` copied to `properties`, c) event with both `data` and `properties` keeps `properties` as-is.

## 7. Phase 2 Fallback: Endpoint Switch (only if Phase 1 doesn't fix streaming)

- [x] 7.1 If Phase 1 doesn't fix streaming, switch `subscribeToEvents()` in `packages/agents/opencode/src/opencode-agent.ts` from `client.event.subscribe()` (`/event` endpoint) to `client.global.event()` (`/global/event` endpoint, matching the TUI). Unwrap `event.payload` in the stream loop since `/global/event` wraps events as `{ payload, directory, workspace }`.

## 8. Phase 3: Debug Logging (only if Phases 1+2 don't fix streaming)

- [x] 8.1 Add temporary debug logging to `chat-view-provider.ts` event handler: log `event.type`, whether `event.properties` exists, and whether `event.data` exists. This helps diagnose what events arrive and in what format. Viewable in webview Developer Tools console.

## 9. Phase 4: message.part.delta Handler (root cause fix)

- [x] 9.1 Add `message.part.delta` to the `AgentEvent` union in `packages/core/src/domain.ts`. Properties: `{ sessionID: string; messageID: string; partID: string; field: string; delta: string }`.

- [x] 9.2 Add a `message.part.delta` case to the switch in `useMessages.ts` `handleMessageEvent`. Find the message by `messageID`, find the part by `partID`, and append `delta` to the part's `text` field. Filter by active session ID. Handle the edge case where the message or part doesn't exist yet (skip — next delta retries).

- [x] 9.3 Update debug logging in `chat-view-provider.ts` to also log `field` and `partID` for `message.part.delta` events so we can confirm the streaming content type.

- [x] 9.4 Add unit tests for `message.part.delta` handling in `useMessages.test.ts`: a) delta appends to existing reasoning part text, b) delta appends to existing text part text, c) delta ignored for inactive session, d) delta ignored when message doesn't exist, e) delta ignored when part doesn't exist.

## 10. Jitter Timing Fix (post-live-verification)

Follow-up to tasks 2.x and 9.x discovered during live verification (task 22). Streaming reasoning text is now correct (overwrite bug fixed) and autoscroll works, but residual jitter remains at flush frequency because `useEffect` fires after browser paint — the user sees content grow before scroll catches up. Additionally, `setTimeout(0)` flush scheduling produces 3-4 intermediate renders per frame (wasted CPU + layout thrash).

- [x] 10.1 Switch `useAutoScroll.ts` scroll effect from `useEffect` to `useLayoutEffect` so scroll updates synchronously after DOM commit, before paint. This eliminates the visible paint-before-scroll gap that causes residual jumps. Keep the selection-aware guard and `isNearBottomRef` check unchanged. Update the stale JSDoc comment (lines 10-13 still mention ResizeObserver, which was removed).

- [x] 10.2 Switch both flush schedulers in `useMessages.ts` (`pendingFlush` for `message.part.delta` and `reasoningPending` for `session.next.reasoning.delta`) from `window.setTimeout(cb, 0)` to `window.requestAnimationFrame(cb)`. This coalesces all deltas arriving within one frame into a single render per frame (max 60fps), eliminating intermediate renders and layout thrash. Update the cleanup useEffect to use `cancelAnimationFrame` instead of `clearTimeout` for both pending refs. The flush callback functions themselves are unchanged.

- [x] 10.3 Mock `requestAnimationFrame` in `packages/platforms/vscode/webview/__tests__/setup.ts` as `window.requestAnimationFrame = (cb) => setTimeout(cb, 0)` and `window.cancelAnimationFrame = (id) => clearTimeout(id)` so existing `vi.useFakeTimers()` + `vi.advanceTimersByTime(0)` test patterns work without modification. The setup file already mocks ResizeObserver and other globals.

- [x] 10.4 Update existing tests in `useMessages.test.ts` and `useAutoScroll.test.ts` if any expectations break due to the rAF/useLayoutEffect change. Tests using `vi.useFakeTimers()` should continue working because rAF is mocked to `setTimeout(cb, 0)`. If a test asserts `useEffect` timing specifically, switch to `vi.advanceTimersByTime(0)` to flush microtasks. Do not weaken assertions.

- [x] 10.5 Prevent duplicate reasoning parts from `message.part.updated` server snapshots. Root cause: `session.next.reasoning.*` events use `reasoningID` while `message.part.updated` uses server-assigned `part.id`. The streaming `ReasoningPart` is created with `id: reasoningID`, so when `message.part.updated` arrives with `part.id: serverID`, `upsertPart` doesn't find the existing part and adds a duplicate with empty/stale text → periodic blank flash every ~0.5-1s. Fix: track which `sessionID:messageID` pairs are managed by reasoning events via a `reasoningMessageKeys` Set ref; mark in `.started`/`.delta`/`.ended`; in `message.part.updated`, skip reasoning parts for managed messages; delete key on `message.removed`. Do NOT delete on `.ended` (late snapshots still use server part ID). Add two regression tests: (a) managed reasoning skips server snapshot, no duplicate; (b) fallback reasoning snapshot still works without reasoning events.

- [x] 10.6 Make managed reasoning text monotonic/sticky during streaming. Prevent duplicate `reasoning.started`, stale/empty `reasoning.ended`, or competing `message.part.delta` events from replacing accumulated reasoning text with empty or shorter text. Keep reasoning buffers after `.ended` until message removal so late deltas/snapshots cannot restart from empty. Add regression tests for duplicate started, empty/short ended, and competing part delta.

- [x] 10.7 Canonicalize reasoning display per assistant message. Multiple `session.next.reasoning.*` streams for the same `sessionID:assistantMessageID` must update one canonical reasoning part instead of creating new empty reasoning parts per `reasoningID`. Map each transient `reasoningID` to the message's canonical reasoning part ID, keep buffers keyed by canonical part ID, and add regression tests for repeated/new reasoning IDs on the same assistant message.

- [x] 10.8 Preserve managed reasoning state across full `messages` snapshot replacement. Host `messages` payloads must merge with local streaming reasoning state instead of replacing managed reasoning parts with empty/stale server snapshots. Public `msg.setMessages(...)` should preserve the longest canonical reasoning text for messages owned by `session.next.reasoning.*`, while initial/session-switch snapshots and non-reasoning parts continue to apply normally. Add regression tests for stale/empty snapshot replacement.

- [x] 10.9 Retain active managed reasoning messages across stale full `messages` snapshots that omit the in-progress assistant message entirely. Full snapshot merge must preserve locally streaming reasoning messages while active, plus a short post-ended grace window, without resurrecting old completed messages after removal/revert/session switch. Add regression tests for omitted-message snapshots.

- [x] 10.10 Add temporary targeted CoT glitch diagnostics. Log only state-length decreases, managed reasoning messages omitted from snapshots, and ReasoningPartView render/remount anomalies so the remaining glitch source can be identified without flooding DevTools. Diagnostics are temporary and must be easy to remove after live testing.

- [x] 10.11 Stabilize `ReasoningPartView` DOM updates during streaming. Replace direct `{part.text}` rendering with a stable body ref updated via `useLayoutEffect` + `textContent`, mirroring `TextPartView`'s streaming-safe DOM pattern. Remove misleading mount/unmount diagnostics that re-fire on text-length updates; keep only the true shrink diagnostic.

- [x] 10.12 Protect `message.part.delta`-driven parts across full `messages` snapshot replacement. Extend `mergeSnapshotPreservingReasoning` to preserve active `deltaBuffers` entries on unmanaged messages. Harden `flushDeltaBuffers` to use `getLongestText` instead of blindly replacing part text. Add regression tests for snapshot blanking of delta-streamed parts and snapshot omission of active delta parts.

## Verification

- [x] Run `npm test` — 1681 tests pass (76→77 files)
- [x] Run `npm run check` — Biome lint/format passes (259 files)
- [x] Run `npm run build` — TypeScript compilation succeeds
- [x] Run `openspec validate --strict` — valid
- [ ] Phase 1 verification: rebuild + reinstall VSIX, test with DeepSeek V4 Pro / Kimi / GLM thinking models
- [ ] Phase 2 verification (if needed): test after endpoint switch
- [ ] Phase 3 verification (if needed): check console logs for event format

