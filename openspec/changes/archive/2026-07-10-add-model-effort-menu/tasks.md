## 1. Selected-model variant capability

- [x] 1.1 Expose one normalized selected-model variant list from `useProviders`, using the current authoritative metadata lookup and fallback; keep restoration and stale-persistence cleanup intact, and add focused hook coverage for metadata changes.

## 2. Dedicated effort menu

- [x] 2.1 Create a localized, accessible `ModelEffortSelector` component with a compact `Default`/selected-value trigger and a radio-style popover of the normalized variants; selecting an option must close the menu and restore input focus.
- [x] 2.2 Wire the selector into `InputArea` beside the model selector only for supported models, move effort presentation out of `ModelSelector`, and make `Ctrl+T` consume the shared variant list without changing its cycle-to-default or prevent-default semantics.

## 3. Behavior coverage

- [x] 3.1 Add focused component and scenario coverage for supported and unsupported rendering, direct variant/default selection, sticky per-model persistence, retained message text and focus, model-label de-duplication, and the existing `Ctrl+T` regression paths.
