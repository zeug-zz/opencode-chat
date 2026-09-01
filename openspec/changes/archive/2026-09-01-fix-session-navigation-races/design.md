## Context

See `proposal.md` for the user-visible problem and scope. The current webview sends a `ready` message again when the active session ID changes. The host handles each incoming message independently, and its refresh operation reads the active session at the start but writes that captured result after several asynchronous calls complete. Session selection and creation also publish results without ordering checks. The session-list backdrop is a full-viewport positioned element, while the header has no higher stacking layer.

The existing UI-to-host and host-to-UI message types already identify sessions where needed. This design therefore uses internal ordering state rather than changing the public protocol or requiring OpenCode SDK cancellation.

## Goals / Non-Goals

**Goals:**

- Make session creation and selection latest-intent-wins across overlapping host operations.
- Keep refresh and list snapshots from publishing session state captured before a newer session operation.
- Use one authoritative message-load path for active-session transitions.
- Keep session-scoped webview state coherent while a new session is loading.
- Keep the session-list dismissal surface below the ChatHeader interaction area.
- Preserve current behavior and wire compatibility for unrelated provider, MCP, sandbox, TUI, and streaming flows.

**Non-Goals:**

- Cancelling in-flight OpenCode SDK requests.
- Redesigning server-side session ordering or persistence.
- Adding public request IDs or changing `UIToHostMessage` / `HostToUIMessage` schemas.
- Persisting the selected session across webview reloads.
- Refactoring unrelated host operations or changing their user-facing semantics except where they can publish stale active-session state.

## Decisions

### Use host-side monotonic operation guards

The host remains authoritative for the active session. A monotonic session-operation generation is advanced when an operation can change or republish active-session state, including create, select, fork, and active-session mutations. Each asynchronous operation captures its generation and source session ID. It may publish active-session or message results only if its generation and session ownership are still current.

Refresh captures the active session and operation generation at its start. If a newer session operation occurred before refresh completion, refresh must not apply its captured active session, messages, or stale session list. It may still publish unrelated environment data from that refresh. A separate list-load sequence prevents an older list response from replacing a newer list snapshot; active-session-changing operations invalidate earlier list loads.

This is preferred over cancelling SDK requests because the SDK and current agent interface do not expose cancellation for these reads, and ignoring stale results is sufficient to preserve correctness. It is preferred over webview-only guards because the host currently owns the active-session variable and can prevent incorrect state from being broadcast to every webview consumer.

### Centralize active-transition message loading in the host

Active-session publication will have one guarded path that sends the active-session notification and then sends exactly one current message snapshot. The webview will retain session-ID filtering as defense in depth but will not automatically request another message snapshot solely in response to every active-session notification. Explicit message refreshes, such as compaction updates, remain supported through the existing `getMessages` message.

When the active session ID changes, the webview clears the previous session's messages and session-scoped auxiliary state before the new snapshot arrives. This prevents old content from appearing under the new title during a slow transition. The active-session notification and existing auxiliary-data requests remain unchanged.

This avoids competing host and webview loads instead of trying to order duplicate requests after they have already started.

### Make initialization one-time and use refs for current session checks

The webview initialization handshake will run on mount rather than as a consequence of active-session ID changes. Session-scoped message handling will read the current active-session ref, so removing the active ID from the handshake effect does not reintroduce stale-closure filtering. Current callbacks that can change during rendering will be accessed through stable refs where necessary.

This preserves reconnect and explicit host refresh behavior while preventing a normal selection from starting another full initialization cycle.

### Keep the header outside the dismissal surface

The session-list backdrop will cover the area below the ChatHeader, or an equivalent stacking arrangement will keep the header above it. The list itself remains above the backdrop. This keeps outside-click dismissal and list selection behavior while allowing the visible new-session and list controls to receive clicks.

### Verify ordering with deferred tests

Extension-host tests will control deferred `getSession`, `createSession`, `listSessions`, and message promises to prove that stale completions are ignored. Webview scenario/component tests will cover the header action while the list is open, active-session transition clearing, and the absence of an extra ready request after selection. Existing session lifecycle and host behavior tests will be updated only where the deliberate duplicate-load removal changes their expected message traffic.

## Risks / Trade-offs

- [Risk] A generation check could suppress a legitimate response from an older operation. → Scope checks to session-scoped publication and keep the latest valid active session; unrelated environment refresh data remains publishable.
- [Risk] Centralizing message loads changes timing relied on by existing tests or edge paths. → Preserve the active-session notification and explicit `getMessages` protocol, cover create/select/fork/refresh paths, and retain webview session-ID filtering.
- [Risk] Clearing state during a transition may briefly show an empty conversation. → Treat the empty interval as the correct loading state rather than displaying another session's content.
- [Risk] The backdrop/header boundary may vary with compact layouts. → Base the boundary on the existing header/list offset and add a regression assertion for the rendered dismissal surface.

## Migration Plan

No data migration or protocol rollout is required. Ship the host and webview changes together, run focused extension-host and webview tests followed by Biome, build, and strict OpenSpec validation. Rollback is a code revert; the existing session message protocol and server-side sessions remain compatible.
