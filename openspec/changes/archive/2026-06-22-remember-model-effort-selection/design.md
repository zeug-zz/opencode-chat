## Context

The previous `add-model-effort-toggle` change added optional effort/variant support while intentionally preserving opencode defaults. The current flow is:

```
InputArea Ctrl+T -> useProviders.selectedModelEffort
                  -> App send/edit payload effort
                  -> ChatViewProvider
                  -> OpenCodeAgent promptAsync({ model, variant })
```

`useProviders` currently keeps `selectedModelEffort` in memory only. The webview already has a platform persistence path through `getPersistedState()` and `setPersistedState()`, used by locale settings, input history, and sound settings.

Context7/OpenCode docs for the official TUI show variant persistence keyed by model (`providerID/modelID`) and a cycle order of `default/unset -> first variant -> next variant -> default/unset`.

## Goals / Non-Goals

**Goals:**
- Remember explicit effort selection per model across VS Code webview reloads.
- Restore only valid efforts advertised by current provider/model metadata.
- Preserve unset/default as a first-class state that sends no `variant`.
- Match official TUI cycle-to-default behavior.
- Keep persistence additive and local to the GUI.

**Non-Goals:**
- Do not write effort into `opencode.json` or any opencode server config file.
- Do not alter `client.session.shell(...)` payloads.
- Do not alter provider/model discovery or hardcode provider effort lists.

## Decisions

### Decision 1: Persist effort in webview `UIPersistedState`

Add an optional field:

```ts
modelEffortByModel?: Record<string, string>;
```

The key is `${providerID}/${modelID}` and the value is the explicit variant id. Missing key means default/unset.

Alternatives considered:
- `opencode.json`: rejected because it changes global opencode configuration and violates the previous non-goal.
- One global effort id: rejected because provider/model variants differ and official TUI persists per model.
- Store labels or full variant objects: rejected because labels are metadata-derived and may change; only the id is needed for restoration.

### Decision 2: Validate before restore or send

`useProviders` remains the source of truth for normalized effort state. On selected model or metadata changes, it should:

1. Resolve current `ModelInfo` using existing `findModelInfo` logic.
2. Read persisted variant id for the current model key.
3. Normalize it through `validateModelVariant(info, { id })`.
4. Set `selectedModelEffort` to the normalized result when valid.
5. Clear stale persisted ids when invalid.

This preserves the existing invariant that downstream payloads only see normalized, supported effort values.

### Decision 3: Write persistence when explicit effort changes

When `setSelectedModelEffort` receives a valid effort for the current model, save its id under the current model key. When it receives `undefined` / `null`, remove the current model key so future reloads restore default/unset.

Persisted writes should merge with the rest of `getPersistedState()` so locale, input history, and sound settings are preserved.

### Decision 4: Cycle back to default/unset

Change `InputArea` cycle behavior from wrapping last variant to first variant to clearing selection at the end of the list:

```
unset -> first -> second -> ... -> last -> unset
```

This matches the official TUI and gives the user an explicit keyboard path back to opencode defaults.

## Risks / Trade-offs

- Webview persisted state is per VS Code webview storage, not opencode global config. This is desired because the feature is GUI stickiness, not server default mutation.
- `useProviders` has to avoid a race where providers arrive before/after selected model. Centralizing restoration in the existing selected-model/metadata effect keeps this manageable.
- Clearing stale persisted ids is slightly more invasive than ignoring them, but prevents repeated invalid restore attempts and keeps persisted state accurate.

## Migration Plan

1. Extend persisted-state type with an optional `modelEffortByModel` map.
2. Add persistence helpers in `useProviders` and wire restoration/invalidation.
3. Adjust `Ctrl+T` cycling to clear at end-of-list.
4. Add focused tests for persisted-state compatibility and cycle-to-default behavior.
5. Run focused webview tests, core tests if touched, and formatting/type checks as available.

Rollback path:
- Remove the optional persisted field and restoration/writing logic. Existing effort forwarding remains additive and optional, so no persisted data migration is required.

## Implementation Notes

- Use existing `getPersistedState` / `setPersistedState` from `packages/platforms/vscode/webview/vscode-api.ts`.
- Keep `findModelInfo` as the metadata resolver; do not duplicate provider lookup outside `useProviders` unless tests require extracting a small helper.
- Prefer storing only valid ids. If validation fails on write, remove the model key or leave it absent.
- Preserve current behavior where `handleModelSelect` posts `{ type: "setModel" }` for the model only.
