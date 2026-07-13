## 1. Core types and protocol

- [x] 1.1 Tighten `McpStatus` / `McpServerStatus` in `packages/core/src/domain.ts` to include `connected: boolean` and optional `tools?: string[]`, and ensure agent mappers remain compatible. **Verify:** `packages/agents/opencode` unit tests for `mapMcpStatus` still pass; TypeScript resolves new type.

- [x] 1.2 Add `mcpEnabledByServer?: Record<string, boolean>` to `UIPersistedState` in `packages/core/src/platform.interface.ts`. **Verify:** core package types compile; no existing `UIPersistedState` consumer required to set the field.

- [x] 1.3 Extend `UIToHostMessage` / `HostToUIMessage` in `packages/core/src/protocol.ts` with `getMcpStatus`, `connectMcp`, `disconnectMcp`, and `mcpStatus`. **Verify:** protocol types compile; no unrelated message variants changed.

## 2. Extension host wiring

- [x] 2.1 Handle `getMcpStatus`, `connectMcp`, and `disconnectMcp` in `chat-view-provider.ts`: call companion agent MCP methods, post `mcpStatus` (or existing error path on failure). **MUST NOT** write `opencode.json`. **Verify:** extend/update `chat-view-provider` tests for success and error paths.

## 3. Webview preference + MCP hook

- [x] 3.1 Implement webview `useMcp` (or equivalent) that: loads/saves `mcpEnabledByServer` via persisted state, requests status on ready when MCP capability is present, re-applies prefs for servers present in both prefs and live status, exposes toggle/refresh APIs. **Verify:** unit tests for first-run (no force), re-apply connect/disconnect diffs, ignore unknown pref keys, toggle updates prefs.

## 4. Settings panel UI

- [x] 4.1 Add MCP section to `ToolConfigPanel` with per-server checkboxes, empty state, and trust notice; preserve language/sound/config-link sections. **Verify:** component tests cover list, empty, toggle callback, trust notice; unrelated sections unchanged.

- [x] 4.2 Wire `useMcp` through `App.tsx` / `InputArea` into `ToolConfigPanel`; refresh on panel open when practical. **Verify:** typecheck/build of vscode webview path; section gated on MCP capability.

## 5. i18n

- [x] 5.1 Add MCP section i18n keys (title, empty, trust, optional error) across locales (`en` required; other locales `en` fallback or matched strings). **Verify:** no missing key usage for new strings; existing keys intact.

## 6. Verification gate

- [x] 6.1 Run focused tests for touched packages and `npm run check` for lint/format. **Verify:** tests green for host/hook/panel; biome clean on changed files; no accidental `opencode.json` writes in tests or implementation.

## 7. Slice add-on: MCP status + startup + density

- [x] 7.1 Correct `McpServerStatus` / lifecycle types in `packages/core/src/domain.ts` and implement **normalizing** `mapMcpStatus` in `packages/agents/opencode/src/mappers.ts` from OpenCode SDK `{ status, error? }` into `{ connected, status, error? }`. Update mappers unit tests for connected/disabled/failed/unknown. **Verify:** mapper tests green; no bare pass-through cast for MCP.

- [x] 7.2 Update webview MCP UI (`ToolConfigPanel`, `useMcp` tests) so checkbox uses normalized `connected`, list still renders server names from real status maps, and optional lifecycle/error label shows when not connected/connected simply. **Verify:** component + hook tests cover real mapped shapes.

- [x] 7.3 Harden `extension.ts` companion connect failures: surface `database is locked` / other non-ENOENT failures with actionable `vscode.window` messages; still register the webview provider when possible so the view is not an infinite silent load; no `opencode.json` writes. **Verify:** unit or behavioral tests for error classification if present; manual code review of activate path.

- [x] 7.4 Replace language radio list in `ToolConfigPanel` with a single select/dropdown; keep all locale options and i18n labels; update component tests. **Verify:** language change still works via tests; no radio list for locales.

- [x] 7.5 Run `npm run check` + focused tests (mappers, useMcp, ToolConfigPanel, extension/host as applicable), then package VSIX and install. **Verify:** biome clean; tests pass; VSIX installs.
