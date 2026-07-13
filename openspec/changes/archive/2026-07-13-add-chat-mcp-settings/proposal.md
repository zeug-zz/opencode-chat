## Why

The chat companion already runs its own OpenCode server process and exposes MCP connect/disconnect/status on `IAgent`, but the gear settings panel cannot toggle MCP servers for chat only. Users must flip shared profile/`opencode.json` flags (which also affect TUI) instead of remembering a chat-local connected set. The companion-scoped server makes per-chat MCP toggles viable without writing global config.

## What Changes

- Add an MCP section to the chat `ToolConfigPanel` (gear settings) listing MCP servers discovered from the companion server, with enable/disable checkboxes.
- Wire webview ↔ host protocol messages for `getMcpStatus`, `connectMcp`, and `disconnectMcp` against the companion-only OpenCode server.
- Persist a chat-local preferred on/off map (`mcpEnabledByServer`) in `UIPersistedState`, and always re-apply that map after companion ready (force connect/disconnect to match). First run with no prefs inherits live companion status until the user toggles.
- Narrow `McpStatus` typing enough for UI (connected + optional tools) without changing the OpenCode SDK.
- Do **not** write or rewrite `opencode.json`, do **not** invent new MCP server definitions, and do **not** change TUI MCP state. Server inventory remains global/project config + profile skill.
- Surface a minimal trust note that user MCP tools remain outside Scout edit/bash denials.

### Slice add-on (post-ship live bugs)

- **MCP status shape:** Map OpenCode SDK MCP statuses (`status: connected|disabled|failed|needs_auth|needs_client_registration`) into domain `connected` (+ optional `status`/`error`) so the list and checkboxes reflect real companion status.
- **Companion start failure:** When `createOpencodeServer` fails (notably SQLite `database is locked` because TUI/another window holds the project DB), do not leave the chat view stuck on an infinite load; register UI or surface a clear VS Code error with remediation.
- **Settings density:** Replace the language radio list with a single dropdown/select to free vertical space in `ToolConfigPanel`.

**Non-goals:**
- MCP server definition editor (command, env, transport).
- Chat-only MCP inventory via `OPENCODE_CONFIG_CONTENT` restart.
- VS Code `configuration` contributions.
- Changing the global `opencode-mcp-profile` skill semantics.

## Capabilities

### New Capabilities
- `chat-mcp-settings`: Companion-only runtime MCP connect/disconnect controls in the settings panel, with remembered chat prefs reapplied on ready.

### Modified Capabilities
- None (no existing main-spec capability covers MCP settings UI or protocol).

## Impact

- **Core:** `UIPersistedState`, `McpStatus` shape, `UIToHostMessage` / `HostToUIMessage` protocol unions.
- **Host:** `chat-view-provider.ts` message handlers calling existing `OpenCodeAgent` MCP methods.
- **Webview:** `ToolConfigPanel`, new `useMcp` (or equivalent) hook, `App.tsx` wiring, i18n locales.
- **Agent:** no server lifecycle change; uses existing `getMcpStatus` / `connectMcp` / `disconnectMcp`.
- **Config files:** untouched; companion process only.
- **Security:** document/restate that MCP tool side-effects are not sandboxed by Scout permissions; toggles only gate connection state.
- **Compatibility:** TUI and global MCP profile remain authoritative for which servers exist; chat prefs only force companion connection state when keys match known servers.
- **Risks / fallback:** servers with `enabled: false` in config may not appear or connect until profile enables them—ignore unknown preference keys; leave status as reported on connect failure and do not crash the panel.
- **Tests:** host handler tests, hook re-apply/diff tests, panel component tests, optional scenario for toggle flow.
