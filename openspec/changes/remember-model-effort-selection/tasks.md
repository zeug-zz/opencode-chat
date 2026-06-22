## 1. Persisted State Contract

- [X] 1.1 Extend `UIPersistedState` with optional per-model effort storage (`modelEffortByModel?: Record<string, string>`); verify existing persisted state callers remain type-compatible and no send/protocol type changes are introduced.

## 2. Effort Restoration And Persistence

- [X] 2.1 Update `useProviders` to restore the persisted effort for the selected `providerID/modelID` after provider metadata is available, normalize it with `validateModelVariant`, and keep unset/default when no valid persisted effort exists; verify with hook tests for restore, missing persisted state, and stale invalid effort.
- [X] 2.2 Update `setSelectedModelEffort` in `useProviders` to write valid effort ids into `modelEffortByModel` and remove the current model key when effort is cleared; verify that unrelated persisted fields such as `localeSetting`, `inputHistory`, and `soundSettings` are preserved.
- [X] 2.3 Ensure model changes use per-model remembered effort: switching to another model restores that model's persisted effort when valid, and switching back restores the first model's effort; verify with hook tests using two models with different variant sets.

## 3. Ctrl+T Default Cycle Parity

- [X] 3.1 Update `InputArea` `Ctrl+T` cycling so the final valid variant cycles back to unset/default instead of wrapping to the first variant; verify with scenario tests that the visible effort label disappears and subsequent sends omit `effort`.

## 4. Integration Verification

- [X] 4.1 Add or update webview scenario coverage proving persisted effort survives an app/webview remount and is included in chat/edit payloads only when restored as valid; verify focused scenario tests pass.
- [X] 4.2 Run repository-appropriate verification for the touched packages, at minimum focused webview hook/scenario tests and the nearest package-level test/build command; record any unrelated pre-existing failures.
