## Context

OpenCode Chat launches a companion `opencode serve` process via `OpenCodeAgent.connect()` with an in-memory Scout agent overlay (`OPENCODE_CONFIG_CONTENT`). That process inherits user MCP definitions from normal OpenCode config discovery (`~/.config/opencode/opencode.json`, project `opencode.json`). The agent already implements `getMcpStatus`, `connectMcp`, and `disconnectMcp` against the companion server only.

There is no webview settings UI or protocol surface for those methods. The gear panel (`ToolConfigPanel`) currently covers locale, sound, and config-file links. Users who want different MCP for chat currently edit shared config (profile skill flips global `enabled` flags), which also affects TUI.

User-selected scope for this change: **runtime connect/disconnect toggles + remembered prefs**, always re-applied on ready against the companion server only.

## Goals / Non-Goals

**Goals:**
- List companion-discovered MCP servers in the gear settings panel.
- Checkbox toggles enable/disable connection on the **chat companion server only**.
- Persist preferred on/off map in webview `UIPersistedState` and force-apply after companion ready.
- Leave TUI and disk `opencode.json` unchanged.
- Preserve server inventory ownership in global/project config and the mcp-profile skill.

**Non-Goals:**
- Authoring new MCP server definitions in-chat.
- Companion server restart with chat-only `mcp` overlay inventory.
- VS Code `contributes.configuration` settings.
- Sandboxing MCP tool side effects beyond existing Scout permission denials.

## Decisions

### 1. Runtime RPC over config rewrite
**Choice:** Use existing `client.mcp.connect/disconnect/status` on the companion process.

**Why:** No file mutation, no server restart, natural process isolation from TUI.

**Alternatives considered:**
- `OPENCODE_CONFIG_CONTENT.mcp` + restart: can invent chat-only inventory but drops SSE subscriptions and needs merge-semantic certainty.
- Mutate `opencode.json`: breaks TUI isolation and conflicts with profile skill safety rules.

### 2. Preference store lives in webview state
**Choice:** Add `mcpEnabledByServer?: Record<string, boolean>` to `UIPersistedState` via existing `vscode.setState`/`getState` bridge.

**Why:** Matches locale/sound/effort patterns; no host persistence redesign.

**Alternative:** `context.globalState` on host — better if host must apply prefs before first webview paint; not required because webview re-apply on init is fine.

### 3. Re-apply policy
**Choice:**
- No prefs yet → do not force transitions; show live status; first user toggle creates prefs keys.
- Prefs present → after init/`getMcpStatus`, for each **known server name** present in both status and prefs: connect if pref true and not connected; disconnect if pref false and connected.
- Pref keys for unknown/missing servers are ignored (kept in storage for optional future reappearance; do not write them back until user saves a toggle, or leave as-is).

**Why:** User chose “always re-apply last chat prefs” without inventing new inventory.

### 4. Protocol surface (additive)
```text
UI → Host: { type: "getMcpStatus" }
UI → Host: { type: "connectMcp"; server: string }
UI → Host: { type: "disconnectMcp"; server: string }
Host → UI: { type: "mcpStatus"; status: McpStatus }
Host → UI: { type: "error"; message: string } // reuse existing error path on failure
```

Host handlers call `IAgent` methods already tested. Capability flag `mcp` already advertised in agent capabilities should gate UI section if unavailable.

### 5. `McpStatus` typing (corrected vs OpenCode SDK)
**Choice:** Align domain types with OpenCode SDK MCP status union, then project a UI-friendly shape:

SDK contact (per server value):
```ts
{ status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"; error?: string }
```

Domain:
```ts
export type McpServerLifecycle =
  | "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration" | "unknown";
export type McpServerStatus = {
  connected: boolean; // true iff status === "connected"
  status: McpServerLifecycle;
  error?: string;
  tools?: string[]; // optional; omit if SDK lacks tools list
};
export type McpStatus = Record<string, McpServerStatus>;
```

**MUST:** `mapMcpStatus` normalize each entry (no bare cast). Treat missing/invalid entries as `{ connected: false, status: "unknown" }`.

**UI:** checkbox uses `connected`; secondary label/status string SHOULD show lifecycle when not simply connected/disconnected.

### 6. UI placement + density
**Choice:** MCP section in `ToolConfigPanel` with checkboxes + status. Language control becomes a single `<select>` (or equivalent dropdown), not a radio list.

When MCP status empty after a successful fetch, show empty copy pointing at Global/Project Config. When status fetch fails, show distinct error state (not the same as empty inventory).

**Why:** User asked for settings gear which already has that panel; radios waste vertical space.

### 7. Application path in webview
**Choice:** `useMcp` hook (or equivalent) owned by `App.tsx`:
- On `init`/ready after capabilities.mcp: request status once.
- Run re-apply from prefs.
- Expose `servers`, `toggle(server, enabled)`, `refresh` to panel
- Persist prefs on each user toggle before/after RPC.
- Panel open SHOULD refresh status (best-effort).

### 8. Security note
**Choice:** Short i18n trust line under the MCP section: companion Scout denials do not sandbox MCP server tools. No new permission system.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Config `enabled: false` servers never show / fail connect | Empty or error UX; profile skill remains inventory path; do not invent offline definitions |
| Connect/disconnect race during toggle | Disable row or optimistic UI with status refresh + error toast |
| Prefs diverge from deleted servers | Ignore unknown keys; list is authority of live status |
| Agent mid-turn loses tools when extinguished | Accept runtime change; no agent restart |
| Preference store only webview-scoped | Document; matches other UI prefs |
| Scout vs MCP trust confusion | Explicit MENSA-style trust note in panel footer of section |

## Migration Plan

1. Ship additive protocol + panel (no migration of old state — new field optional).
2. Rollback: omit UI section or feature-flag off handlers; unused `mcpEnabledByServer` is harmless.
3. No archive/config migration for profile scripts.

### 9. Companion connect failure / `database is locked`
**Choice:** Treat connect failures as non-fatal activation for the webview surface where practical:
- Detect message substrings such as `database is locked` / `Server exited`.
- Show an actionable VS Code error/warning (close TUI/other OpenCode for this project, reload window).
- Prefer still registering `ChatViewProvider` so the side bar is not an infinite spinner; if agent has no client, ready/`getMcpStatus`/session handlers fail with clear messages.
- **MUST NOT** rewrite `opencode.json` to recover.

SQLite lock is outside this extension’s multi-process isolation model; remediating the lock is operator action (close contending OpenCode processes).

## Open Questions

- Confirm live OpenCode `mcp.status` includes disabled-but-defined servers (code defensively).
- Whether tools array display is useful; optional for v1.
- Whether multi-root workspaces should prefer a folder that is not merely `workspaceFolders[0]` (out of scope for this slice unless connect failure analysis requires it).
