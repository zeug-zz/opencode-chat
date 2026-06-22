## Why

OpenCodeGUI currently initializes the primary agent selector by choosing the first primary/all agent returned by opencode. In the standard opencode agent order this selects `build`, causing the GUI to return to Build mode after extension/webview reloads even when the user expects Plan mode to be the safer default.

## What Changes

- Prefer a primary/all agent named `plan` when the agent list is first loaded and no primary agent has already been selected.
- Preserve the existing fallback to the first primary/all agent when `plan` is not available.
- Preserve explicit in-memory user selection once a primary agent is already selected.
- Add focused webview coverage for default primary-agent initialization.

## Scope

- In scope: initial primary-agent selection in the VS Code webview state flow.
- In scope: tests proving `plan` is preferred, fallback behavior remains intact, and user selection is not overwritten by subsequent agent-list updates.
- Out of scope: adding a configurable VS Code setting, changing opencode server/config behavior, renaming agents, or changing subagent mention behavior.

## Non-Goals

- Do not introduce an `opencode.json` default-agent contract.
- Do not change how selected primary agents are sent to `client.session.promptAsync`.
- Do not persist selected primary agent across webview reloads in this change.

## Capabilities

### New Capabilities

- `primary-agent-selection`: Defines how OpenCodeGUI initializes and preserves the selected primary agent.

### Modified Capabilities

- None.

## Risks

- Users who intentionally relied on the implicit first-agent default will now see `plan` selected when available. Mitigation: the fallback still uses the first primary/all agent when `plan` is absent, and explicit user selection in the active webview remains authoritative.
- Agent names are server-provided strings. Mitigation: match only the exact built-in `plan` name and keep the existing first-agent fallback for renamed/custom environments.

## Fallback

If the new default proves undesirable, revert the selection predicate in `App.tsx` to the current first primary/all lookup. No migration or data cleanup is required because the selected primary agent is held in webview memory only.

## Compatibility Impact

- No protocol, SDK, opencode config, dependency, or persisted-data changes.
- Existing send behavior remains compatible because `primaryAgent` is already optional and already forwarded when selected.

## Impact

- Affected code: `packages/platforms/vscode/webview/App.tsx`.
- Affected tests: webview scenario tests under `packages/platforms/vscode/webview/__tests__/scenarios/`.
