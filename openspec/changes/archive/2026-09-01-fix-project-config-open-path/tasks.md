## 1. Implementation

- [x] 1.1 Change the Project Config link in `ToolConfigPanel.tsx` to target `${paths.directory}/.opencode/opencode.json` (Global Config link unchanged) and update the Project Config expectation in `webview/__tests__/scenarios/09-settings.test.tsx` to assert `filePath: "/workspace/.opencode/opencode.json"`. **Verify:** focused webview scenario test `09-settings` passes and no other test references the old root path for Project Config.

## 2. Verification

- [x] 2.1 Run the focused webview scenario test for settings and the ToolConfigPanel component test. **Verify:** `npm run test -- webview/__tests__/scenarios/09-settings.test.tsx` and the ToolConfigPanel component test pass, plus `npm run check` (Biome) is clean on the changed files.
