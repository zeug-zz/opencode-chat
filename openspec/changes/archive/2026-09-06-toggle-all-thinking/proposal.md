## Why

Reasoning parts are currently collapsed individually, so reviewing a response while a model is thinking requires repeatedly opening each block. A persisted presentation preference will let users see all available reasoning as it streams and quickly return to the quieter default when the extra detail is too much.

## What Changes

- Add a persisted webview preference for showing all reasoning/thinking parts.
- Add an accessible checkbox to the existing OpenCode Research settings popover.
- When enabled, render all current and streaming reasoning bodies without changing reasoning event buffering or transport.
- When disabled, restore the existing per-reasoning expansion behavior, including manual expansion state.
- Preserve the current default of collapsed reasoning for users without the new preference.

Non-goals:

- No VS Code configuration setting or OpenCode project/global configuration change.
- No changes to OpenCode agent behavior, reasoning event handling, streaming buffers, or host protocol messages.
- No forced removal of the existing per-reasoning toggle.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `openspec/specs/reasoning-streaming/spec.md`: allow a persisted global presentation preference to show reasoning bodies while preserving collapsed-by-default behavior when it is disabled.

## Impact

The change affects the shared `UIPersistedState` type, webview application/settings state, the settings panel, reasoning rendering components, all supported locale dictionaries, and focused webview tests. It adds no dependencies, host handlers, agent APIs, or wire-protocol messages. Older persisted state remains compatible because the missing preference defaults to `false`; disabling the preference is the fallback when rendering all reasoning is undesirable.
