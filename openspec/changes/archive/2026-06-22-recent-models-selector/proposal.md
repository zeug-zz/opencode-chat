## Why

The opencode-chat model selector now supports search across all providers, but selecting a frequently used model still requires navigating provider sections or typing a query every time. The official opencode TUI surfaces a `Recent` list in its `/models` command so the last few used models are one click away. opencode-chat has no equivalent: the recent-models history is not tracked or surfaced, so the GUI feels slower than the TUI for model switching.

This makes the GUI inconsistent: model and effort selection are already sticky through existing persistence, yet recently used models are not surfaced for quick recall.

## What Changes

- Track the last used models in VS Code webview persisted state as an ordered list, capped at five.
- Record a model in the recent list at the moment it is selected in the model selector (TUI parity).
- Surface a `Recent` section pinned at the top of the model selector panel, shown only when not searching.
- Render each recent row as the model name with its provider name greyed beside it (TUI parity).
- Skip stale recent entries whose model or provider no longer appears in provider metadata.
- Selecting a recent entry reuses the existing model-selection path; the model's sticky effort (if any) restores through the existing `modelEffortByModel` logic without new effort display in the Recent rows.

## Scope

- In scope: `UIPersistedState`, the `useProviders` hook, the `ModelSelector` component, the `InputArea` and `App` prop threading, locale strings, and focused webview tests.
- In scope: compatibility with existing persisted state containing only locale, input history, sound settings, or `modelEffortByModel`.
- Out of scope: changing effort persistence or display, changing provider/model discovery, writing recency into `opencode.json`, or altering the send/edit protocol payloads.

## Non-Goals

- Do not display effort labels inside the `Recent` section rows (effort stays sticky via existing per-model persistence and restores automatically on select).
- Do not record recency on message send; recency is recorded on model selection only.
- Do not add a provider/grouping collapse control to the `Recent` section.
- Do not change the search behavior or the connected/disconnected provider toggle.

## Capabilities

### Added Capabilities

- `model-selector`: The model selector surfaces the last used models (capped at five) for one-click recall, with each recent model shown alongside its provider name.

## Risks

- Persisted recent entries may reference models or providers that disappear from provider metadata. Mitigation: filter stale entries out of the rendered `Recent` section and leave persisted state intact (no destructive pruning on read).
- Persisting recent models globally could surface provider names the user no longer has configured. Mitigation: stale filtering on render prevents showing unavailable models; a future change may prune persisted entries.
- Existing persisted state may not contain the new field. Mitigation: the new field is optional and defaults to an empty recent list.

## Fallback

If the `Recent` section causes problems, remove the new persisted-state field, the `recentModels` hook state, and the `Recent` render block. Existing model selection, effort persistence, search, and provider toggle remain unchanged because recency is purely additive and read-only on restore.

## Compatibility Impact

- Existing webview persisted state remains valid.
- Existing `modelEffortByModel` persistence and restoration remain unchanged.
- Existing selected-model persistence through `opencode.json` remains unchanged.
- Existing send/edit payloads remain unchanged.

## Impact

- Affected code: `packages/core/src/platform.interface.ts`, `packages/platforms/vscode/webview/hooks/useProviders.ts`, `packages/platforms/vscode/webview/components/molecules/ModelSelector/ModelSelector.tsx`, `packages/platforms/vscode/webview/components/organisms/InputArea/InputArea.tsx`, `packages/platforms/vscode/webview/App.tsx`, and the eight locale files under `packages/platforms/vscode/webview/locales/`.
- Affected tests: focused webview hook/scenario/component tests under `packages/platforms/vscode/webview/__tests__/`.
