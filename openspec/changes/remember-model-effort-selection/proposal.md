## Why

`opencode-chat` can cycle and send an explicit model effort/variant, but the selection is held only in React state. Reloading the VS Code webview, closing/reopening the view, or refreshing the extension loses the selected effort even though the official opencode TUI remembers the selected variant for the current model.

This makes the GUI feel inconsistent: model selection is sticky through existing persistence, while effort selection silently resets to opencode default after a UI lifecycle event.

## What Changes

- Persist explicit GUI model effort selections in VS Code webview persisted state.
- Store effort by model key (`providerID/modelID`) so different models can remember different variants.
- Restore a persisted effort only when the current provider metadata still advertises that variant for the selected model.
- Preserve the unset/default state as distinct from any explicit effort selection.
- Adjust `Ctrl+T` cycling to match official TUI semantics by cycling from the last variant back to default/unset.
- Add focused hook and scenario tests for persistence, restoration, invalidation, default omission, and cycle-to-default behavior.

## Scope

- In scope: `UIPersistedState`, VS Code webview provider/model effort state, `Ctrl+T` cycle semantics, and focused webview tests.
- In scope: compatibility with existing persisted state containing only locale, input history, or sound settings.
- Out of scope: writing effort into `opencode.json`, changing opencode server defaults, changing provider metadata discovery, or extending shell command payloads with effort.

## Non-Goals

- Do not persist effort into opencode config files.
- Do not invent effort names for models that lack `variants` metadata.
- Do not make a full effort selector UI beyond the existing `Ctrl+T` and visible label behavior.
- Do not change prompt payload semantics when effort is unset.

## Capabilities

### Modified Capabilities

- `model-effort-control`: Model effort selections become sticky per selected model while preserving opencode defaults unless a valid explicit effort is selected.

## Risks

- Persisted effort may become stale when provider metadata changes. Mitigation: validate against current `ModelInfo.variants` before displaying or sending, and clear stale entries.
- Persisting a variant globally could change cost/intelligence unexpectedly. Mitigation: store only in webview state and send only when explicitly selected/restored as valid for the selected model.
- Existing persisted state may not contain the new field. Mitigation: the new field is optional and defaults to no persisted effort.

## Fallback

If sticky effort causes problems, remove the new persisted-state field and restoration logic. Existing protocol and agent forwarding remain compatible because effort is already optional and omitted by default.

## Compatibility Impact

- Existing webview persisted state remains valid.
- Existing selected-model persistence through `opencode.json` remains unchanged.
- Existing send/edit payloads remain unchanged when no explicit effort is selected.
- Shell command execution remains unchanged and still omits effort.

## Impact

- Affected code: `packages/core/src/platform.interface.ts`, `packages/platforms/vscode/webview/hooks/useProviders.ts`, and `packages/platforms/vscode/webview/components/organisms/InputArea/InputArea.tsx`.
- Affected tests: focused webview hook/scenario tests under `packages/platforms/vscode/webview/__tests__/`.
