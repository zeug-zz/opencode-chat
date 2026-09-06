## Context

The existing webview receives and buffers reasoning deltas in `useMessages`, while each `ReasoningPartView` owns a local collapsed/expanded flag. The settings popover already controls persisted webview presentation preferences through `UIPersistedState`; the reasoning renderer already updates an expanded body incrementally with the existing animation-frame stream path. See `proposal.md` and the reasoning-streaming delta for the user-visible contract.

## Goals / Non-Goals

**Goals:**

- Persist one global presentation preference with a backward-compatible disabled default.
- Make the existing settings popover the discoverable control surface.
- Show current and future reasoning bodies immediately when enabled, including live deltas.
- Preserve manual per-block expansion state when the global preference is disabled.
- Keep the existing agent, host protocol, event filtering, buffering, and rendering architecture intact.

**Non-Goals:**

- Do not add a VS Code configuration key or write OpenCode configuration.
- Do not change which reasoning events are received, stored, or filtered.
- Do not replace the existing per-block header toggle.
- Do not add a separate global state manager or a new runtime dependency.

## Decisions

1. **Store the preference in `UIPersistedState` as an optional boolean.**
   The webview already persists locale, sound, model, and MCP presentation preferences through the bridge. The missing field will resolve to `false`, so existing webview state and users retain collapsed-by-default behavior. A host protocol message or OpenCode config entry would add plumbing without changing agent behavior.

2. **Keep state ownership in `App` and use explicit component props.**
   `App` will read and persist the setting, pass it to `InputArea` for the controlled settings checkbox, and pass it through `MessagesArea` to `MessageItem`/`ReasoningPartView` for rendering. This keeps the setting's data flow visible and avoids broadening the already-large application context for a value used by one rendering path.

3. **Use a global visibility override rather than resetting local component state.**
   The effective reasoning visibility will be `showAllThinking || expanded`. Enabling the preference therefore makes all reasoning bodies visible, including newly created streaming parts. Disabling it reveals each part's existing local expansion state; users who had not manually opened a part return to the normal collapsed view. This is smaller and less surprising than introducing a reset token or synchronizing every reasoning component's local state.

4. **Preserve the existing streaming DOM update path.**
   The global preference only controls whether the reasoning body is mounted. `useMessages` continues to accumulate monotonic reasoning text and `ReasoningPartView` continues to update its stable body element with the existing layout effect. No event, buffer, or snapshot-merging logic changes.

5. **Place one accessible checkbox in a dedicated thinking section of `ToolConfigPanel`.**
   The existing toggle styling and label structure will be reused. The label and checkbox state will be localized in all supported dictionaries. Tests will query controls by accessible name rather than relying on checkbox order.

6. **Update memo boundaries explicitly.**
   The `MessageItem` and `ReasoningPartView` memo comparisons must include the global visibility value where it crosses each boundary. Otherwise a preference change could leave already-rendered reasoning rows stale even though their message data is unchanged.

## Risks / Trade-offs

- [Risk] Enabling the preference mounts more reasoning DOM nodes and can increase visual density or rendering work for long sessions → Mitigate with the existing checkbox as an immediate opt-out and keep the implementation presentational-only.
- [Risk] A global override can make an individual header click appear ineffective while the preference is enabled → Keep the existing local state intact and document the effective behavior in tests; disabling the global preference restores per-block controls.
- [Risk] Adding a checkbox can break tests that select controls by position → Update those tests to use accessible labels and add direct controlled-checkbox coverage.
- [Risk] Users may have persisted state from before the feature → Treat an absent field as `false`; no migration is required.

## Migration Plan

No data migration or rollout step is required. Deploying the webview with the optional field makes the checkbox available immediately; older persisted state remains valid. If the feature is rolled back, the unknown persisted field is ignored and existing collapsed reasoning behavior remains intact.
