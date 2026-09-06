# FIFO Queued Prompt Plan

## Goal

Match the useful part of the OpenCode TUI queue: prompts entered while Chat or Write is busy wait in order, and Stop interrupts the active turn without discarding queued prompts. After the session reaches its terminal idle state, the next queued prompt is sent automatically.

The first version should support multiple FIFO prompts without adding durable storage, prompt editing, or a dependency on the newer OpenCode delivery API.

## Current Flow

The shared `InputArea` currently returns early on Enter while `isBusy` is true. `App.handleSend` builds a complete `sendMessage` payload and posts it to the webview protocol. `ChatViewProvider` forwards that payload to `IAgent.sendMessage`, which calls the v1 SDK `session.promptAsync`; Stop calls `session.abort`.

The host already receives and forwards `session.status` events, but it does not serialize sends. The current `@opencode-ai/sdk` dependency exposes `promptAsync`, while the newer `delivery` queue contract belongs to a different session API. The first implementation should therefore use a local coordinator rather than upgrade or mix SDK contracts.

## Design

### Host-Owned Queue

Keep queue state in `ChatViewProvider`, keyed by session ID:

- Store the full normal `sendMessage` payload so model, effort, files, selected agents, skills, commands, and system overrides survive queueing.
- Maintain a FIFO list for each session.
- Track sessions with an active or just-admitted prompt so concurrent webview messages cannot bypass the queue before the first busy event arrives.
- Queue only normal `sendMessage` operations. Leave edit-and-resend, session operations, and shell routing unchanged.
- Keep the queue in memory. It may survive a webview rerender while the extension host remains alive, but it is discarded on extension restart.
- Drop queued entries when their session is deleted. A session switch must not retarget a queued prompt to another session.

### Send and Drain Lifecycle

Use the existing host event path as the serialization point:

- If a normal send arrives for an idle session, mark it active before awaiting the agent call and forward it immediately.
- If a normal send arrives for a busy or just-admitted session, append it and publish the new count to the webview.
- On `session.status: idle`, clear the active guard and dispatch exactly one queued item, marking the session active before dispatch.
- Do not dispatch the next item until another idle event arrives. This prevents `promptAsync` admission from racing with the server's busy transition.
- Treat an abort as an interruption only. The abort handler must leave the queue intact; the idle event caused by the abort performs the normal drain.
- Preserve the existing error path and do not silently advance past a failed queued item. The queue coordinator must clear its active guard without losing the failed payload, or surface a bounded failure state if the existing error contract is extended.
- Ignore status events for other sessions and do not let a stale active-session event drain the wrong queue.

### Protocol and UI

Add one host-to-webview status message, for example:

```ts
{ type: "queuedPrompts"; sessionId: string; count: number }
```

Do not add a queue flag to `sendMessage`; the host owns admission and keeps the existing payload compatible with all current callers.

Update the shared UI:

- Remove the busy Enter early-return in `InputArea`; a valid prompt submitted while busy should use the same `onSend` path.
- Keep the Send/Stop button switch. Stop continues to post `abort` for the active session.
- Show a compact localized `Queued: N` status near the input controls when the active session has pending prompts.
- Clear the visible count when the host reports zero or when the active session changes.
- Preserve current IME, popup, attachment, model, effort, agent, and command behavior.

Both Chat/Scout and Write/Build use the same queue because they share the provider, App, and InputArea path. No agent permission changes are needed.

## Files

Expected implementation and contract updates:

- `packages/platforms/vscode/src/chat-view-provider.ts`: add per-session FIFO state, active-send guards, idle draining, queue cleanup, and queue status publication.
- `packages/core/src/protocol.ts`: add the host-to-webview queued-count message; leave the normal send payload unchanged.
- `packages/platforms/vscode/webview/App.tsx`: consume queue status, scope it to the active session, and pass the count to `InputArea`.
- `packages/platforms/vscode/webview/components/organisms/InputArea/InputArea.tsx`: allow busy Enter submissions and render the queued count.
- `packages/platforms/vscode/webview/components/organisms/InputArea/InputArea.module.css`: add only the compact status styling required by the indicator.
- `packages/platforms/vscode/webview/locales/*.ts`: add the queue label and accessible text in every supported locale.
- `packages/platforms/vscode/src/__tests__/chat-view-provider.test.ts`: cover admission, FIFO ordering, idle draining, session isolation, deletion, and abort behavior.
- `packages/platforms/vscode/webview/__tests__/scenarios/03-messaging.test.tsx`: cover the indicator, Stop with pending prompts, and idle-driven dispatch.
- `packages/platforms/vscode/webview/__tests__/scenarios/13-keyboard-ime.test.tsx`: replace the busy-Enter no-op assertion with queue admission while preserving IME assertions.
- Add focused App/InputArea tests only where the existing scenario coverage cannot observe queue counts or payload preservation.

## Non-Goals

- Do not upgrade the OpenCode SDK solely to use the v2 `delivery` field.
- Do not persist queued prompts in session history or `UIPersistedState`.
- Do not implement prompt editing, removal, reordering, retry UI, or queue limits in the first version.
- Do not queue edit-and-resend or unrelated session operations.
- Do not send a queued prompt immediately after calling abort; wait for the session's idle transition.
- Do not change agent permissions, sandbox behavior, MCP behavior, or TUI queue semantics.

## Risks and Mitigations

- **Prompt races before the busy event:** mark a dispatch active synchronously before calling `promptAsync` and serialize all subsequent sends through the host.
- **Abort and queue overlap:** retain the queue during abort and drain only from the matching idle event.
- **Stale session events:** key all state and status messages by session ID and clear or ignore entries during deletion.
- **Webview reload loses visible state:** republish the active session's queue count during initialization; queue contents remain host-owned while the host is alive.
- **A failed dispatch blocks the queue:** retain the failed item and clear the active guard without silently dropping work; cover the behavior with a focused host test.
- **SDK/server version drift:** keep the existing `promptAsync` and `abort` calls, and test against the installed SDK contract rather than assuming v2 delivery support.

## Verification

Run focused host and webview queue tests, the full test suite, Biome checks, OpenSpec validation, and the extension build. Verify that:

- Idle sends are forwarded immediately.
- Multiple busy submissions are stored and delivered in exact FIFO order.
- Each queued payload preserves its original model, effort, files, agent, skill, and command data.
- Only one queued prompt is dispatched per idle transition.
- Stop aborts the active run and then allows the next queued prompt to start.
- A session switch cannot send a prompt to the wrong session.
- Deleting a session removes its queue.
- Chat and Write share the behavior without changing their tool permissions.
- Existing IME and send/stop behavior remains correct.

## Rollback

Rollback is limited to removing the queue status message, host queue state, indicator, locale keys, and focused tests. Restore the current busy Enter no-op and direct `sendMessage` forwarding. No persisted data migration is required.
