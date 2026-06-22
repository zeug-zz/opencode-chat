## 1. Persisted State Contract

- [X] 1.1 Extend `UIPersistedState` in `packages/core/src/platform.interface.ts` with an optional `recentModels?: Array<{ providerID: string; modelID: string }>` field; verify existing persisted-state callers (`useInputHistory`, `useSoundNotification`, `useLocale`, `useProviders`) remain type-compatible and no send/protocol type changes are introduced.

## 2. Recency Recording

- [X] 2.1 Add reactive `recentModels` state to `useProviders` (initialized from `getPersistedState()?.recentModels ?? []`); in `handleModelSelect` (currently at line 124) prepend the selected `{ providerID, modelID }`, dedupe by `providerID` + `modelID`, cap at five, then `setPersistedState` (merging with the rest of `getPersistedState()` to preserve `localeSetting`, `inputHistory`, `soundSettings`, and `modelEffortByModel`) and `setRecentModels`; expose `recentModels` from the hook return. Add hook tests in `__tests__/hooks/useProviders.test.ts` covering dedupe, move-to-front, five-cap, and persistence-merge preservation.

## 3. Selector Wiring And Rendering

- [X] 3.1 Thread `recentModels` from `useProviders` through `App.tsx` (lines ~543-553) and `InputArea` (props at lines 30-73, render at lines 794-801) down to `ModelSelector`; add a `recentModels` prop to `ModelSelector`.
- [X] 3.2 In `ModelSelector.tsx`, render a `Recent` section pinned at the top of the panel body (above the provider sections), shown only when `!isSearching` (line 88). Render a static (non-collapsible) header using the `model.recent` locale key. For each recent entry, resolve the provider and model display name from the existing `allDisplayProviders` memo (lines 48-77); skip entries whose `providerID` or `modelID` is absent (stale filtering on read, no persisted pruning). Render each row reusing `.item`/`.itemName`/`.itemCheck`, with the model name followed by the provider name in a new `.itemProvider` muted style (`var(--vscode-descriptionForeground)`, mirroring `.itemMeta`). Clicking a row calls `onSelect({ providerID, modelID })` then `close()`, identical to the main list. Do not render effort in recent rows. Add component tests covering: recent renders with greyed provider, hidden while searching, stale entries filtered, click selects, empty recent renders no section.

## 4. Internationalization

- [X] 4.1 Add `"model.recent": "Recent"` (plus a translated value) to all eight locale files under `packages/platforms/vscode/webview/locales/`: `en.ts`, `ja.ts`, `zh-cn.ts`, `zh-tw.ts`, `pt-br.ts`, `es.ts`, `ru.ts`, `ko.ts`; place the key adjacent to the existing `model.*` keys.

## 5. Integration Verification

- [X] 5.1 Add a scenario test in `__tests__/scenarios/` proving that selecting a model and reopening the selector surfaces it under `Recent` with its provider name greyed, that selecting a recent entry switches the selected model (and the model's persisted effort restores through existing logic), and that the `Recent` section is hidden while searching. Run `npm run check` and `npm test`; record any unrelated pre-existing failures.
