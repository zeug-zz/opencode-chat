## 1. Production Implementation

- [x] 1.1 Implement the persisted `showAllThinking` preference and complete production wiring: extend `UIPersistedState`, initialize and persist the value from the existing webview bridge in `App`, expose it through `InputArea`, add the controlled checkbox and localized labels in `ToolConfigPanel` and all eight locale dictionaries, and pass the value through `MessagesArea`/`MessageItem` to `ReasoningPartView` so enabled mode shows current and streaming reasoning while disabled mode preserves local expansion state; update memo comparisons as needed. Verify with `npm run build` and Biome on all touched production files.

## 2. Regression Coverage

- [x] 2.1 Add or update settings and component tests for the controlled thinking checkbox, default-off behavior, persisted state read/write, localized key consistency, and robust sound-checkbox selection after the new control is added. Verify the focused settings and `ToolConfigPanel` tests pass.
- [x] 2.2 Add or update reasoning display and streaming tests covering global visibility for existing and newly streaming parts, continued delta rendering, default collapsed behavior when disabled, and restoration of per-part manual expansion state. Verify the focused reasoning scenarios and related component tests pass.

## 3. Final Verification

- [x] 3.1 Run the full affected verification gate: `npm run test:all`, `npm run check`, `npm run build`, `openspec validate "toggle-all-thinking" --strict`, and `git diff --check`; inspect `git status --short` and the final diff to confirm only scoped implementation, tests, and OpenSpec artifacts changed.
