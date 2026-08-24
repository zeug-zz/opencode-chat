## Why

Starting Chat launches a separate OpenCode companion that eagerly starts every
inherited MCP server not explicitly marked disabled in the user's OpenCode
config. With Firecrawl, PDF readers, and other local `npm` MCPs inherited from
global or project config, each Chat activation spawns multiple MCP child
processes the user never selected, causing memory pressure and surprise
startup cost. The existing Gear-panel toggles only remediate after the fact:
the companion is already running the extra processes.

## What Changes

- Resolve the MCP inventory (server names + effective enabled state) from the
  user's global and project OpenCode config files **before** the companion
  starts, and build a launch-time overlay that marks every not-user-selected
  server as disabled for the Chat companion only.
- First use defaults to all MCPs unselected: Chat launches with zero inherited
  MCP children until the user explicitly enables one in the Gear panel.
- Persist the per-server Chat selection in workspace-scoped host state so a
  user-selected MCP stays selected across Chat and VS Code companion
  restarts; keep the existing webview store synchronized with the host store.
- Migrate existing webview-only `mcpEnabledByServer` preferences into host
  state on first ready, then keep both stores in sync.
- Apply the same launch-time filter on the sandboxed and unsandboxed
  companion launch paths (both `createOpencodeServer` config and
  `OPENCODE_CONFIG_CONTENT` overlays).
- Build the overlay from **only** server names and `enabled` flags. It never
  copies MCP `env`, `environment`, `headers`, API keys, commands, or other
  definitions into `OPENCODE_CONFIG_CONTENT`.
- Treat explicit global/project `enabled: false` as a TUI-side default, not
  Chat authority: the companion-only Chat overlay may set `enabled: true` for
  an explicitly selected inventoried server, without changing the TUI or its
  config.
- Re-apply saved preferences automatically only when a server status is
  `disabled` or `unknown`; never automatically retry `failed`, `needs_auth`,
  or `needs_client_registration` statuses. Manual Gear toggles remain allowed
  to issue connect requests, and identical status echoes MUST be idempotent
  while a fresh companion/status reset still permits one sticky reapply.
- Fail closed when the launch-time inventory cannot be resolved safely: Chat
  reports unavailable with a visible error rather than silently falling back
  to inheriting and starting all MCPs.
- Preserve existing MCP status/diagnostics, listener/session behavior,
  Gear-panel toggles, sandbox controls, and companion cleanup.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-mcp-settings`: Change MCP preference persistence from webview-only
  state to workspace-scoped host state with migration and bidirectional
  synchronization; add launch-time MCP startup filtering with a secret-free
  overlay, TUI-only config defaults, fail-closed inventory resolution, and
  sandbox/unsandboxed parity.

## Impact

- `packages/core/src/protocol.ts`: new `setMcpPrefs` (UI→Host) and
  `mcpPrefs` (Host→UI, retaining the compatibility `locked` field) messages; host
  workspace-state key for chat MCP preferences.
- `packages/agents/opencode/src/launch-config.ts`: carry the sanitized MCP
  overlay on `OpenCodeLaunchConfiguration`.
- `packages/agents/opencode/src/opencode-agent.ts`: merge the MCP overlay into
  both `connect()` (unsandboxed) and `connectSandboxed()`
  (`OPENCODE_CONFIG_CONTENT`); keep `getMcpStatus`/`connectMcp`/
  `disconnectMcp` behavior and diagnostics unchanged.
- New MCP inventory/overlay module in the agent package (config-file parsing
  for server names + enabled state only; JSONC-tolerant; never reads secret
  values into the overlay).
- `packages/platforms/vscode/src/extension.ts`: resolve inventory and build
  the overlay before `connectAgent`, at activation and on every companion
  restart; persist/read chat MCP prefs via `context.workspaceState`; fail
  closed (visible error, webview still registered) when inventory resolution
  fails.
- `packages/platforms/vscode/src/chat-view-provider.ts`: `ready`-time
  migration and `mcpPrefs`/`setMcpPrefs` message handling.
- `packages/platforms/vscode/webview/hooks/useMcp.ts`: adopt host prefs,
  propagate toggle changes to the host.
- Agent, host, and webview tests for overlay construction, no-secret
  invariant, fail-closed startup, migration/sync, parity, and TUI isolation.
- `README.md` and `packages/platforms/vscode/README.md`: document startup
  filtering, workspace-scoped persistence, and the fail-closed behavior.

This change does not modify independent OpenCode CLI/TUI behavior, global or
project `opencode.json` on disk, the `setModel` config-file workaround, VS
Code-wide agent or sandbox settings, or the companion lifecycle.

### Scope and Non-goals

- The overlay is scoped to the Chat companion process only; it is never
  written to disk and never affects independent TUI/CLI processes.
- No MCP server definitions (commands, env, headers, keys, URLs) are copied
  into the overlay; disabling is expressed purely as `enabled: false` entries.
- No changes to Gear-panel toggle UX or status normalization.
- No per-MCP permissions, autostart scheduling, or MCP "last selected at
  startup" heuristics.
- No changes to the sandbox filesystem/network policy itself.

## Risks and Fallback

- Inventory parsing is new launch-time code: a regression could fail Chat
  startup. Mitigation: fail-closed path is visible and recoverable (fix
  config or reload), unit-tested JSONC-tolerant parsing, and existing
  `database is locked`-style webview-registration behavior is reused.
- Webview-only prefs from before this change could be lost if migration runs
  incorrectly. Mitigation: migration only when host state is empty, keep the
  webview store as a synchronized copy, and cover both orders (host-empty and
  host-populated) with tests.
- Overlay merge semantics of the installed OpenCode version could differ
  (e.g., per-server deep merge vs. replace). Mitigation: overlay entries
  contain only `enabled`, which is the documented mechanism for overriding
  inherited servers; verify against the installed OpenCode during
  implementation and fall back to fail-closed diagnostics if merge behavior
  is not the documented one.
- If inventory cannot be resolved, Chat is unavailable until config is
  repaired; this is deliberate (never silently start all MCPs).
- Re-applying a saved preference after a failed startup could otherwise create
  an npm/npx spawn storm as the host echoes the same failure. Mitigation: gate
  automatic connects by lifecycle, guard each server's last processed
  status/action, reset that guard for a fresh companion/host-pref/ready
  lifecycle or real status transition, and retain the existing visible MCP
  diagnostics/error output.

## Compatibility Impact

Existing Gear-panel behavior is preserved: status still comes from the
companion, toggles still call `connectMcp`/`disconnectMcp`, and preferences
are still re-applied after ready. The behavioral difference is at startup:
unselected servers now report `disabled` instead of `connected` until
explicitly enabled. Independent TUI/CLI processes inherit the full config
unchanged. Global and project `opencode.json` are never rewritten by this
change.

Automatic preference re-apply is lifecycle-aware: only `disabled` and
`unknown` statuses may produce automatic connect actions. `failed`,
`needs_auth`, and `needs_client_registration` statuses remain visible with
their diagnostics and do not cause automatic retries. Manual Gear toggles
remain explicit retry/disconnect controls. Repeated identical snapshots must
not repeat an already-issued action, while a fresh companion/status reset or a
real status transition must permit the appropriate sticky reapply.
