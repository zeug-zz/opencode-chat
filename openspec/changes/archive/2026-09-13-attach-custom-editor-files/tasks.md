# Implementation tasks: attach-custom-editor-files

All tasks are intentionally unchecked and must be completed one at a time in
dependency order. Do not change core protocol/domain types, agent/SDK
attachment mapping, sandbox, permissions, or persistence unless a later
verification proves the existing contract cannot be preserved.

## 1. Establish safe tab/file resolution

- [x] **1.1** Inspect the installed VS Code typings and existing test mocks,
  then add the smallest platform-layer helper needed to resolve a
  `TabInputText` or `TabInputCustom` input to a file URI and existing
  workspace-relative `FileAttachment`. Reject missing inputs, missing URIs,
  non-`file` schemes, and unusable paths without throwing. Keep ordinary text
  behavior byte-for-byte compatible where possible.
- **Depends on:** none
- **Verification:**
  - `pnpm --filter opencode-scribe run test:ext -- src/__tests__/vscode-platform-services.test.ts`
  - `pnpm exec biome check packages/platforms/vscode/src/vscode-platform-services.ts`

## 2. Extend open-editor picker inventory

- [x] **2.1** Update `VscodePlatformServices.getOpenEditors()` to use the safe
  resolver for text and file-backed custom tabs, preserve path deduplication,
  and omit non-file custom/webview tabs. Add focused host tests for an
  Office Viewer-style Markdown custom tab, an ordinary text tab, and a
  non-file or missing-URI custom tab.
- **Depends on:** 1.1
- **Verification:**
  - `pnpm --filter opencode-scribe run test:ext -- src/__tests__/vscode-platform-services.test.ts`
  - `pnpm exec biome check packages/platforms/vscode/src/vscode-platform-services.ts packages/platforms/vscode/src/__tests__/vscode-platform-services.test.ts`

## 3. Resolve active file-backed custom tabs

- [x] **3.1** Extend `ChatViewProvider` active-file resolution so the existing
  active text-editor attachment remains preferred and an active file-backed
  custom tab is used when no usable text-editor file exists. Keep the existing
  `activeEditor` host message and null behavior for unsupported tabs. Add host
  tests for active custom, ordinary text compatibility, and non-file custom
  negative behavior.
- **Depends on:** 1.1, 2.1
- **Verification:**
  - `pnpm --filter opencode-scribe run test:ext -- src/__tests__/chat-view-provider.test.ts`
  - `pnpm exec biome check packages/platforms/vscode/src/chat-view-provider.ts packages/platforms/vscode/src/__tests__/chat-view-provider.test.ts`

## 4. Refresh quick-add on custom-tab activation

- [x] **4.1** Register the appropriate VS Code tab-group activation/change
  listener and route it through the active-file publisher so switching among
  text, file-backed custom, and non-file custom tabs updates or clears the
  existing quick-add state. Preserve initial `ready` publication and the
  existing text-editor listener. Add a focused host regression for the event
  callback and its emitted attachment.
- **Depends on:** 3.1
- **Verification:**
  - `pnpm --filter opencode-scribe run test:ext -- src/__tests__/chat-view-provider.test.ts`
  - `pnpm exec biome check packages/platforms/vscode/src/chat-view-provider.ts packages/platforms/vscode/src/__tests__/chat-view-provider.test.ts`

## 5. Confirm webview regression and unchanged send contract

- [x] **5.1** Extend the file-context webview scenario only as needed to prove
  that a custom-editor-derived `activeEditor` message drives the existing
  quick-add control, replacement/clearing works, and sending retains the
  existing `{ filePath, fileName }` payload. Do not add protocol fields or
  provider-specific UI.
- **Depends on:** 4.1
- **Verification:**
  - `pnpm --filter opencode-scribe run test -- webview/__tests__/scenarios/07-file-context.test.tsx`
  - `pnpm exec biome check packages/platforms/vscode/webview/__tests__/scenarios/07-file-context.test.tsx`

## 6. Run change-level verification

- [x] **6.1** Re-read this change's proposal, design, spec, and completed task
  diffs; verify no implementation path broadened webview access or changed the
  core/agent contract. Run the focused host and webview tests, then the normal
  repository gates. Leave all implementation tasks marked complete only after
  their individual evidence is recorded by the planner.
- **Depends on:** 2.1, 4.1, 5.1
- **Verification:**
  - `pnpm --filter opencode-scribe run test:ext -- src/__tests__/vscode-platform-services.test.ts src/__tests__/chat-view-provider.test.ts`
  - `pnpm --filter opencode-scribe run test`
  - `pnpm run check`
  - `pnpm run build`
  - `openspec validate "attach-custom-editor-files" --strict`
  - `git diff --check`
