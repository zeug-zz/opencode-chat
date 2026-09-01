## Why

The chat settings panel **Project Config** button opens (or silently creates)
`<workspace>/opencode.json` at the workspace root. The actual project-local
OpenCode configuration lives at `<workspace>/.opencode/opencode.json`, so the
button either opens the wrong file or, when the root file does not exist,
writes a stray `opencode.json` into the workspace root. This pollutes
repositories and frustrates users editing their real local config.

## What Changes

- The **Project Config** button in `ToolConfigPanel` targets
  `<workspace>/.opencode/opencode.json` instead of `<workspace>/opencode.json`.
- The **Global Config** button is unchanged.
- The settings scenario test is updated to assert the corrected project config
  path.

## Capabilities

### New Capabilities

- `project-config-link`: The chat settings panel exposes a Project Config link
  that opens the project-local OpenCode configuration file
  (`<workspace>/.opencode/opencode.json`) and never writes a stray
  `opencode.json` at the workspace root.

### Modified Capabilities

None.

## Impact

- `packages/platforms/vscode/webview/components/organisms/ToolConfigPanel/ToolConfigPanel.tsx`
  (one path string).
- `packages/platforms/vscode/webview/__tests__/scenarios/09-settings.test.tsx`
  (expected `openConfigFile` path for Project Config).
- No protocol, host, or agent changes. The host `openConfigFile` flow
  (open existing, create only when missing) is unchanged.
