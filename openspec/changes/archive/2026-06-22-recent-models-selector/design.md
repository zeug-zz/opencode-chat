## Context

opencode-chat already persists model effort per model via `modelEffortByModel` (keyed `${providerID}/${modelID}`) in `UIPersistedState`, and the `ModelSelector` component (`packages/platforms/vscode/webview/components/molecules/ModelSelector/ModelSelector.tsx`) renders a search-enabled panel grouped by provider section. The current flow is:

```
ModelSelector onSelect -> InputArea onModelSelect
                       -> App prov.handleModelSelect
                       -> useProviders.setSelectedModel + postMessage({ type: "setModel" })
```

`useProviders.handleModelSelect` (line 124) is the single chokepoint where a model is chosen in the GUI. The webview already has a platform persistence path through `getPersistedState()` and `setPersistedState()`, used by locale settings, input history, sound settings, and per-model effort.

The official opencode TUI `/models` command surfaces a `Recent` list of the last used models, each shown with its provider name, for one-click recall. opencode-chat has no equivalent.

## Goals / Non-Goals

**Goals:**
- Surface the last used models (capped at five) at the top of the model selector panel.
- Record a model in the recent list at selection time (TUI parity).
- Show each recent model with its provider name greyed beside it (TUI parity).
- Hide the `Recent` section while the user is searching.
- Keep recency additive and local to the GUI.

**Non-Goals:**
- Do not display effort in the `Recent` rows.
- Do not record recency on message send.
- Do not write recency into `opencode.json` or any opencode server config file.
- Do not prune persisted recent entries destructively on read.

## Decisions

### Decision 1: Store recent models as a structured array in `UIPersistedState`

Add an optional field:

```ts
recentModels?: Array<{ providerID: string; modelID: string }>;
```

Entries are ordered most-recent-first, deduplicated by `providerID` + `modelID`, capped at five. Structured objects are used instead of `"providerID/modelID"` string keys because `modelID` can contain `/` (e.g. `minimax/minimax-m3`), which makes naive split-on-`/` ambiguous when parsing back to `{ providerID, modelID }`. Effort lookup for a recent entry still uses the `${providerID}/${modelID}` template against the existing `modelEffortByModel` map if needed, but the `Recent` section does not render effort.

Alternatives considered:
- String keys: rejected because of modelID slash ambiguity on parse-back.
- Store effort alongside each recent entry: rejected because `modelEffortByModel` already persists effort per model and restores it automatically on select; duplicating it would create two sources of truth.
- Cap higher than five: rejected to match the user's stated `<=5` requirement and TUI parity.

### Decision 2: Record recency on model selection in `useProviders.handleModelSelect`

`handleModelSelect` (line 124) is the single chokepoint for GUI model selection. Building the next list there — prepend the selected model, dedupe, cap at five, then `setPersistedState` + `setRecentModels` — keeps recency consistent with the existing selection path and the `setModel` postMessage. Recency is not recorded on message send because the user's requirement and the TUI both tie recency to model choice, not message activity.

### Decision 3: Do not render effort in the `Recent` rows

Effort is already sticky per model through `modelEffortByModel`. When a recent model is selected, the existing restoration `useEffect` in `useProviders` (lines 50-122) restores that model's persisted effort automatically. Showing effort in the `Recent` rows would duplicate the effort label that already appears on the selector trigger button and would require threading `modelEffortByModel` + variant metadata into the selector. Instead, each recent row shows the model name with its provider name greyed beside it, matching the TUI.

### Decision 4: Pin the `Recent` section at the top of the panel, hidden while searching

The `Recent` section renders above the provider sections, with a static (non-collapsible) header. It is hidden while the search query is non-empty (TUI parity: the `Recent` list only appears when no filter is active). Stale entries — whose `providerID` or `modelID` no longer appears in `allDisplayProviders` — are skipped on render; persisted state is left intact (no destructive pruning on read).

### Decision 5: Reuse the muted description color for the greyed provider name

The provider name in each recent row uses `var(--vscode-descriptionForeground)`, the same muted color already used by `.itemMeta` and `.sectionTitle`. A new `.itemProvider` style mirrors `.itemMeta` typography so the greyed provider sits inline after the model name without a separator dot.

## Risks / Trade-offs

- Webview persisted state is per VS Code webview storage, not opencode global config. This is desired because recency is a GUI convenience, not a server setting.
- Stale recent entries can accumulate in persisted state if providers are removed. Mitigation: render-time filtering hides them; persisted state is preserved to avoid surprising data loss. A future change may prune.
- Threading `recentModels` through `App` -> `InputArea` -> `ModelSelector` adds one prop to two intermediate components. This matches the existing pattern for `providers`, `allProvidersData`, and `selectedModelEffort`.

## Migration Plan

1. Extend `UIPersistedState` with the optional `recentModels` array.
2. Add `recentModels` reactive state and recording logic to `useProviders.handleModelSelect`; expose it from the hook.
3. Thread `recentModels` from `App` through `InputArea` to `ModelSelector`.
4. Render the `Recent` section in `ModelSelector` with render-time stale filtering and search-hidden behavior.
5. Add the `model.recent` locale key to all eight locale files.
6. Add focused hook, component, and scenario tests.
7. Run focused webview tests and `npm run check`.

Rollback path:
- Remove the optional persisted field, the `recentModels` hook state, the prop threading, and the `Recent` render block. Existing model selection, effort persistence, search, and provider toggle remain additive and unaffected.

## Implementation Notes

- Use existing `getPersistedState` / `setPersistedState` from `packages/platforms/vscode/webview/vscode-api.ts`.
- Resolve the provider display name and model display name in `ModelSelector` from the existing `allDisplayProviders` memo (lines 48-77); do not duplicate provider lookup.
- Keep `handleModelSelect` posting `{ type: "setModel" }` for the model only; do not change the message shape.
- Preserve existing persisted fields (`localeSetting`, `inputHistory`, `soundSettings`, `modelEffortByModel`) when writing `recentModels` by merging with the rest of `getPersistedState()`.
- The `Recent` section must not render during search: gate it on `!isSearching` (line 88), the same flag already used by `visibleProviders`.
- Reuse `.item`, `.itemName`, `.itemCheck` styles for recent rows; add a single `.itemProvider` muted style for the greyed provider name.
