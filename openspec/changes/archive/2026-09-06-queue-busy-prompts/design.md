## Context

See `proposal.md` and `specs/prompt-queue/spec.md` for the motivation and observable contract. The webview currently prevents Enter while `isBusy`, then sends a complete `sendMessage` payload through the bridge. `ChatViewProvider` forwards normal sends directly to `IAgent.sendMessage`, while the agent event subscription already forwards `session.status` events to the webview. The installed agent API remains the existing `promptAsync`/abort contract; no native delivery queue is available to this change.

## Goals / Non-Goals

**Goals:**

- Add a small host-side coordinator around the existing normal-send and status-event paths.
- Make admission synchronous before the first asynchronous agent call so rapid webview messages cannot overlap.
- Preserve exact payload snapshots and session identity through FIFO delivery, aborts, failures, rerenders, and session navigation.
- Expose only a typed pending-count message to the webview and keep queue presentation in the shared input.
- Cover lifecycle races and compatibility behavior with focused host and scenario tests.

**Non-Goals:**

- Do not replace the OpenCode SDK, add a delivery field, or create a server-side queue.
- Do not persist prompts, add queue editing/removal/reordering/retry controls, or change session history.
- Do not queue edit-and-resend, shell, permission, MCP, sandbox, or unrelated session operations.
- Do not alter agent permissions, process isolation, configuration ownership, or independent TUI behavior.

## Decisions

### 1. Keep queue state in `ChatViewProvider`

The extension host is already the serialization boundary for webview messages and receives the authoritative session lifecycle events. Keep a `Map` keyed by session ID with normal-send payload snapshots, plus per-session admission/status state, in `ChatViewProvider` rather than adding a webview queue hook or changing `IAgent`. This preserves one implementation for Chat and Write and ensures the selected `primaryAgent`, effort, files, guidance, and system values travel with the prompt.

A prompt submitted while a session has an active admission or a non-empty pending list is appended. An idle session with no pending list is admitted immediately. State remains in memory, is discarded with the provider on extension restart, and is removed when the corresponding session is deleted. A session change only changes which queue may be displayed or drained; it never changes the session ID stored on an item.

**Alternative considered:** a single `queuedPrompt` in the webview. Rejected because it loses FIFO capacity, can race with host handlers, and cannot safely coordinate status events or session identity. A server-native queue was also rejected because the supported SDK exposes `promptAsync`, not the newer delivery contract.

### 2. Mark admission before awaiting `sendMessage`

The normal-send handler will snapshot and classify the payload synchronously. It marks the session as active before invoking the agent. The first admitted payload is dispatched immediately; later payloads are appended and return after publishing the new count. A dispatch that succeeds keeps the active guard until a matching terminal idle event, because `promptAsync` completion is not the generation endpoint.

The status path will track enough per-session lifecycle state to distinguish a real busy-to-idle completion from duplicate idle notifications and from an idle notification that belongs to the previous prompt before a newly dispatched queued item has emitted busy. A Stop request records the existing abort operation but never calls the queue dispatcher directly; the matching idle event remains the sequencing point. Status events for a different session cannot drain the currently active session's queue. If an inactive session completes while its queue is retained, its count remains keyed to that session and can only be considered when that session is active again.

**Alternative considered:** serialize by awaiting each `sendMessage` promise. Rejected because the SDK promise can resolve on admission before the server reports the run idle, which would overlap generations.

### 3. Retain failed work at the queue head

The dispatch helper will remove a queued item only for the duration of its agent call. On rejection it restores that item at the front, clears the active guard, publishes the unchanged pending count, and routes the error through the existing bounded host error handling. It will not advance to a later item as part of failure handling. The same retention rule applies if the first direct dispatch fails, so no payload is silently lost; no new retry UI or implicit skip is introduced.

**Alternative considered:** drop a failed item and continue. Rejected because it silently loses user work and violates FIFO. A new failure protocol was also rejected for this first version; existing host error behavior remains the compatibility boundary.

### 4. Add a narrow host-to-webview count message

Extend `HostToUIMessage` with `{ type: "queuedPrompts"; sessionId: string; count: number }`. The host publishes counts after admission, dispatch/removal, restoration after failure, deletion, and initialization/active-session publication. `App` stores only the count belonging to `activeSessionRef`, resets it when the active session changes, and passes it to the existing `InputArea`. The input renders a localized status element only for positive counts; the Send/Stop control remains unchanged, so Stop is still the only action on the busy button.

**Alternative considered:** add a `queued` flag or alternate send message. Rejected because admission is a host concern and the existing payload must remain compatible with current callers.

### 5. Update the shared input without changing submission semantics

Remove only the busy early return from the normal Enter branch. Keep the IME composition guard, popup dismissal, text/file/guidance clearing, history update, and current Send/Stop switch. Add one compact CSS-module status style and locale entries for all supported locales. Scenario tests will observe the real `App` and bridge messages; host tests will use deferred agent calls and captured event callbacks to make the ordering assertions deterministic.

## Risks / Trade-offs

- **Rapid sends race the first busy event** → Set the active guard synchronously before the first await and test multiple submissions in the same turn.
- **Duplicate or stale idle events drain too far** → Track per-session observed status/admission state and drain at most one item per real completion boundary; filter foreign sessions.
- **Abort overlaps dispatch** → Leave the queue untouched in the abort handler and drain only from the matching idle event.
- **Switching sessions exposes stale counts or work** → Include the session ID in every count, reset the webview count on active-session changes, and never rewrite a queued item's session ID; delete the source queue on deletion.
- **A failed send blocks later prompts** → Retain the failed item at the head and clear the guard without silently advancing; preserve the existing error path and test the count.
- **Payload references change before dispatch** → Snapshot the normal-send object and its mutable arrays at admission, while retaining the existing optional-property wire semantics.
- **UI changes regress IME or mode behavior** → Update the existing keyboard scenario rather than removing its composition coverage, and assert original `primaryAgent` values for Chat and Write.

## Migration Plan

No migration is required. Queue state is intentionally transient and no protocol field is added to UI-to-host `sendMessage`. Deploying the change adds the host-to-webview count message and indicator; rolling back removes the coordinator, count message, UI/CSS/locale additions, and focused tests, restoring the busy Enter early return and direct normal-send forwarding. Existing sessions, configuration files, SDK calls, MCP, sandbox, permissions, and TUI state require no conversion.

## Open Questions

None. Failure retention, session scoping, idle sequencing, and the no-persistence boundary are fixed by the proposal and delta specification.
