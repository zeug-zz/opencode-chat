## Why

The session list can display stale data, restore an older session after a selection, or make the new-session action appear ineffective. The underlying selection requests are not ordered, and the reusable refresh path introduced for reconnect and sandbox updates can publish data captured before the user changed sessions. The visible plus button is also covered by the session-list backdrop while the list is open.

## What Changes

- Define latest-intent-wins behavior for creating and selecting sessions.
- Prevent refresh, message, and session-list responses belonging to an older session operation from replacing newer UI state.
- Prevent active-session changes from causing redundant initialization refreshes.
- Consolidate session message loading so a transition does not issue competing duplicate loads.
- Keep the ChatHeader actions, including the new-session button, clickable while the session list is open.
- Add deterministic webview and extension-host regression coverage for ordering, stale responses, and the overlay interaction.

## Capabilities

### New Capabilities

- `session-navigation`: Reliable normal session listing, creation, selection, and session-scoped loading across asynchronous refreshes.

### Modified Capabilities

None.

## Impact

The change affects the VS Code webview session-list and message-handling flow, `useSession`, `App`, session-list styling, and `ChatViewProvider` request coordination. It adds no server or public protocol requirement and must preserve existing `UIToHostMessage` and `HostToUIMessage` compatibility. It does not change TUI handoff, MCP, sandbox policy, session ordering policy, or OpenCode server APIs.

Scope is limited to normal session navigation and its refresh/load coordination. It does not introduce cancellation of OpenCode SDK requests, redesign session sorting, or persist a selected session across webview reloads. The main risk is suppressing a legitimate update as stale; generation checks must be applied only to session-scoped results, while unrelated provider and environment refresh data remains available. If a request fails, existing error handling and the last valid active session must remain intact.
