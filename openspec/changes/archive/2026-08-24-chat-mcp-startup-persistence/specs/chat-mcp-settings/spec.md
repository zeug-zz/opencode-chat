## ADDED Requirements

### Requirement: Chat companion starts with unselected MCPs disabled

The extension MUST resolve the MCP inventory from the user's OpenCode
configuration before starting the Chat companion and MUST launch the
companion with a startup overlay that marks every MCP server the user has not
selected as disabled. On first use, when no Chat MCP preferences exist,
MUST default to all servers unselected so the companion starts no inherited
MCP children. The same startup filtering MUST apply to the sandboxed and
unsandboxed companion launch paths. The overlay MUST be applied before the
companion begins loading servers and MUST NOT be applied to independent
OpenCode processes.

#### Scenario: First use starts zero MCP children

- **WHEN** Chat is started for a workspace with no saved MCP preferences
- **AND** the user's global or project OpenCode config defines local MCP servers
- **THEN** the companion MUST start with all inherited servers marked disabled
- **AND** the companion MUST report zero MCP child processes started at launch
- **AND** companion status MUST list those servers as `disabled`

#### Scenario: Gear-panel selection starts only that server

- **WHEN** the user enables exactly one MCP server in the Gear panel
- **AND** the Chat companion is (re)started
- **THEN** the startup overlay MUST mark only that server enabled
- **AND** only that server's MCP child process MUST be started by the companion
- **AND** every other inherited server MUST remain disabled for the Chat
  companion

#### Scenario: Selection survives companion restart

- **WHEN** a saved Chat MCP selection exists for the workspace
- **AND** the Chat companion restarts (including sandbox or network setting
  transitions)
- **THEN** the restarted companion MUST re-apply the saved selection at launch
- **AND** the selected servers MUST connect without requiring a manual toggle
- **AND** unselected servers MUST remain disabled

#### Scenario: Sandboxed and unsandboxed launches filter identically

- **WHEN** the Chat companion is launched with the same workspace and MCP
  preferences through the unsandboxed path
- **OR** through the sandboxed path with sandboxing enabled
- **THEN** both companions MUST receive the same startup MCP overlay
- **AND** both MUST start only the selected servers

#### Scenario: Independent TUI is unaffected

- **WHEN** the user starts an independent OpenCode CLI/TUI process (including
  a session handoff)
- **THEN** that process MUST inherit the full user OpenCode configuration
  unchanged
- **AND** the Chat startup overlay MUST NOT affect its MCP startup behavior

### Requirement: Chat launch MCP overlay carries no secrets

The startup overlay MUST express server state using only server names and
`enabled` boolean flags. It MUST NOT copy MCP commands, environment
variables, headers, URLs, API keys, or any other server definition into the
overlay content. The overlay MUST be delivered to the companion in memory
only and MUST NOT be written to `opencode.json`, `.mcp.json`, or any config
file on disk.

#### Scenario: Overlay contains only names and enabled flags

- **WHEN** the extension builds the launch overlay from a config whose MCP
  servers define commands, `env`/`environment` variables, headers, and API
  keys
- **THEN** the serialized overlay content MUST contain only entries shaped as
  `{ "<server-name>": { "enabled": true|false } }`
- **AND** it MUST NOT contain any command, environment variable, header,
  URL, API-key, or other definition value

#### Scenario: Overlay is never written to disk

- **WHEN** the companion is started with the overlay
- **THEN** the extension MUST NOT create or modify any OpenCode config file
- **AND** the overlay MUST exist only in the companion process
  configuration/env content

#### Scenario: Overlay content stays out of diagnostics

- **WHEN** companion or MCP diagnostics are produced after an overlay-filtered
  launch
- **THEN** the overlay payload MUST be redacted or absent from any
  user-visible diagnostic output

### Requirement: OpenCode config disabled state is TUI-only for Chat

An OpenCode config `enabled: false` MUST govern independent TUI/CLI startup,
but MUST NOT prevent Chat from enabling an explicitly selected inventoried
server in its companion-only overlay. With no Chat preference, the server MUST
remain off in Chat. The overlay MUST preserve the inherited server definition,
MUST remain in memory only, and MUST NOT affect TUI/CLI startup or config files.

#### Scenario: No Chat preference keeps a TUI-disabled server off in Chat

- **WHEN** a server is explicitly `enabled: false` in the user's global or
  project OpenCode config
- **AND** no Chat preference selects that server
- **THEN** the Chat startup overlay MUST mark the server disabled
- **AND** the Chat companion MUST NOT start that server's MCP child

#### Scenario: Explicit Chat preference enables a TUI-disabled server

- **WHEN** a server is explicitly `enabled: false` in the TUI config
- **AND** the user explicitly selects that inventoried server in Chat
- **THEN** the Chat overlay MUST set that server `enabled: true`
- **AND** the overlay MUST preserve the inherited server definition
- **AND** the server MUST be able to connect and reconnect in Chat

#### Scenario: Chat selection persists across companion and sandbox transitions

- **WHEN** a TUI-disabled server is selected in Chat
- **AND** the companion restarts or transitions between sandboxed and
  unsandboxed operation
- **THEN** the saved Chat preference MUST continue to enable the server
- **AND** the server MUST reconnect without a new manual selection

#### Scenario: TUI remains disabled and config files remain unchanged

- **WHEN** Chat selects and connects a server disabled by TUI config
- **THEN** an independent TUI/CLI MUST keep that server disabled
- **AND** `opencode.json` and `.mcp.json` MUST remain unchanged
- **AND** the Chat overlay MUST NOT be visible to or applied by the TUI

### Requirement: Chat MCP inventory failure fails closed

The extension MUST resolve the launch-time MCP inventory before starting the
companion. If the inventory cannot be resolved safely (config files
unreadable or unparsable), Chat MUST fail closed or report unavailable with
a visible error, and MUST NOT silently start the companion with all inherited
MCPs enabled.

#### Scenario: Unreadable inventory reports Chat unavailable

- **WHEN** the MCP inventory cannot be resolved before launch (unreadable or
  unparsable config file)
- **THEN** the extension MUST NOT start the companion with inherited MCPs
  enabled
- **AND** it MUST surface a visible error explaining that Chat could not
  start because the MCP inventory could not be read
- **AND** the webview MUST remain registered so the error is visible rather
  than an infinite spinner

#### Scenario: No silent fallback to all MCPs

- **WHEN** any launch-time inventory resolution step fails
- **THEN** the extension MUST NOT fall back to launching the companion
  without the startup filter
- **AND** it MUST NOT start any MCP child that the filter would have disabled

#### Scenario: Recovery after config repair

- **WHEN** the user repairs the unreadable configuration (or removes the
  invalid file)
- **AND** reloads or restarts Chat
- **THEN** inventory resolution MUST succeed and Chat MUST start with the
  normal startup filtering applied

## MODIFIED Requirements

### Requirement: Chat MCP preferences are remembered and reapplied

The system MUST persist a per-server Chat MCP preference map of MCP server
names to desired enabled state. The authoritative copy MUST be stored in
workspace-scoped host state so it survives Chat and VS Code companion
restarts. The extension MUST apply the stored map when building the
companion startup overlay before launch, and MUST also re-apply it against
live companion status after the chat UI is ready as a convergence step.
When preferences exist, the system MUST re-apply them against live companion
status after the chat UI is ready so companion connection state matches the
stored map for known servers. On first ready, the system MUST migrate
webview-only preferences into host state when host state is empty, and MUST
keep the webview store and host store synchronized thereafter. Saved Chat
preferences MUST be applied to every inventoried server, including servers
explicitly disabled in the OpenCode config. The protocol wire shape MUST
remain `{ prefs, locked }` for compatibility, and Chat MUST send `locked: []`
because no server is locked by TUI config under this policy.

Automatic preference re-apply MUST produce connect actions only when the
server lifecycle is `disabled` or `unknown`. It MUST NOT automatically retry
servers in `failed`, `needs_auth`, or `needs_client_registration` states.
Manual Gear-panel toggles remain allowed to issue explicit connect requests,
including retries for those states. Re-apply processing MUST be idempotent per
server: an identical status snapshot that already triggered an action MUST
not trigger a duplicate connect or disconnect action. A fresh companion
host-pref/ready lifecycle or a genuine status transition MUST reset the
relevant guard so one saved preference re-apply remains possible. A
deterministic per-server snapshot guard is sufficient; timestamps and backoff
are not required.

#### Scenario: First run with no preferences

- **WHEN** host and webview stores for `mcpEnabledByServer` are absent or
  empty
- **THEN** the startup overlay MUST mark all inherited servers disabled
- **AND** the first user toggle MUST store that server's preference key in
  both the host and webview stores

#### Scenario: Re-apply saved preferences on ready

- **WHEN** the chat UI becomes ready and saved preferences contain known
  server keys
- **THEN** for each server present in both live status and preferences with
  `true`, the system MUST connect if not connected
- **AND** for each server present in both with `false`, the system MUST
  disconnect if connected
- **AND** preference keys that do not appear in live status MUST be ignored
  for re-apply

#### Scenario: Preferences survive companion and host restarts

- **WHEN** the user sets MCP preferences and the Chat companion or the VS
  Code extension host restarts
- **THEN** the preferences MUST still be available from workspace-scoped
  host state
- **AND** the startup overlay MUST be built from those preferences before the
  companion launches
- **AND** re-apply MUST run again after ready as convergence

#### Scenario: Preferences survive webview remount

- **WHEN** the user sets MCP preferences and the webview state is restored
- **THEN** the preferences MUST still be available from the webview
  `UIPersistedState` store
- **AND** the synchronized host store MUST still contain the authoritative
  map
- **AND** re-apply MUST run again after ready

#### Scenario: Webview-only preferences migrate to host state

- **WHEN** the chat UI first becomes ready
- **AND** host state has no chat MCP preferences
- **AND** the webview store contains `mcpEnabledByServer` preferences
- **THEN** the extension MUST adopt the webview preferences into host state
- **AND** subsequent restarts MUST build the startup overlay from host state

#### Scenario: Webview and host stores stay synchronized

- **WHEN** the user toggles a server in the Gear panel
- **THEN** the webview store MUST be updated for immediate UI state
- **AND** the webview MUST notify the host of the change
- **AND** the host MUST persist the updated map in workspace-scoped state

#### Scenario: Re-apply includes config-disabled servers selected in Chat

- **WHEN** saved preferences contain `true` for a server explicitly disabled
  in the user's OpenCode config
- **THEN** the re-apply step MUST send a connect request when that server is
  present in live status and disconnected
- **AND** the server MUST be enabled in Chat
- **AND** the host-to-webview `mcpPrefs` message MUST carry `locked: []`

#### Scenario: Re-apply skips config-disabled servers

- **WHEN** a config-disabled server has no `true` Chat preference
- **THEN** the re-apply step MUST NOT send a connect request for that server
- **AND** the server MUST remain disabled in Chat

#### Scenario: Automatic re-apply does not retry terminal startup states

- **WHEN** a saved `true` preference is present for a disconnected server
- **AND** its lifecycle status is `failed`, `needs_auth`, or
  `needs_client_registration`
- **THEN** automatic preference re-apply MUST NOT send a `connectMcp` request
- **AND** the lifecycle and diagnostic/error output MUST remain visible
- **AND** a manual Gear-panel enable toggle MUST still be allowed to send
  `connectMcp`

#### Scenario: Automatic re-apply is limited to disabled or unknown states

- **WHEN** a saved `true` preference is present for a disconnected server
- **AND** its lifecycle status is `disabled` or `unknown`
- **THEN** automatic preference re-apply MUST send at most one `connectMcp`
  action for the processed snapshot

#### Scenario: Identical status echoes are idempotent

- **WHEN** a status snapshot for a server has already triggered its required
  automatic connect or disconnect action
- **AND** the companion echoes an identical status snapshot
- **THEN** the webview MUST NOT send a duplicate action for that server

#### Scenario: Restart or status transition permits sticky re-apply

- **WHEN** the companion emits a fresh host-pref/ready lifecycle or the
  server makes a genuine status transition
- **AND** a saved preference still differs from the live disconnected state
- **THEN** automatic re-apply MUST be permitted to send one appropriate action
- **AND** the saved preference MUST converge without requiring a manual toggle

### Requirement: Compatibility and non-goals boundaries

This capability MUST remain companion-scoped and inventory-compatible with
existing OpenCode config ownership. The Chat MCP startup filter and
preference stores MUST NOT mutate global or project OpenCode configuration,
MUST NOT affect independent OpenCode CLI/TUI processes, and MUST NOT invent
MCP definitions for unknown servers.

#### Scenario: No global config mutation

- **WHEN** any MCP toggle, re-apply, migration, or overlay build runs
- **THEN** the extension MUST NOT create or rewrite `opencode.json` or
  `.mcp.json` on disk for those paths

#### Scenario: Unknown servers are not invented

- **WHEN** a preference names a server that is not present in the launch
  inventory or in companion status
- **THEN** the system MUST NOT invent an MCP definition for it
- **AND** MUST only operate on servers returned by the inventory and
  companion status

#### Scenario: Independent TUI inherits full config

- **WHEN** an independent OpenCode TUI/CLI process starts on the same
  workspace
- **THEN** it MUST inherit the complete user OpenCode configuration,
  including all configured MCP servers
- **AND** the Chat startup overlay MUST NOT be visible to or applied by that
  process
