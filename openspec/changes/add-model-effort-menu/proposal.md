## Why

Model effort is currently available only through `Ctrl+T`, which is efficient for experienced users but difficult to discover and inconvenient for choosing a specific advertised variant. The GUI already persists and validates per-model effort, so it needs a direct, capability-aware menu without changing OpenCode defaults or the existing shortcut.

## What Changes

- Add a dedicated effort menu beside the model selector when the selected model advertises valid variants.
- Let users explicitly choose `Default` or any advertised variant from the menu.
- Keep `Ctrl+T` cycling unchanged: unset/default → each valid variant in metadata order → unset/default.
- Move the visible effort value from the model selector into the dedicated effort control to avoid duplicate presentation.
- Centralize selected-model variant resolution so rendering and shortcut cycling use the same validated capability data.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `model-effort-control`: Add the supported-model menu interaction and make the dedicated control the canonical visible effort selection UI while preserving sticky per-model selection, default semantics, and `Ctrl+T`.

## Impact

- Webview input toolbar and model/effort selector components.
- Provider state derivation in `packages/platforms/vscode/webview/hooks/useProviders.ts`.
- Webview locales and focused component, scenario, and hook tests.
- No OpenCode configuration, protocol, extension-host, or agent API changes.