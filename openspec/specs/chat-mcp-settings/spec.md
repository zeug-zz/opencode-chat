# chat-mcp-settings Specification

## Purpose
Companion-only MCP connection controls in the chat settings gear: list servers from the chat OpenCode process, toggle connect/disconnect without writing opencode.json, remember per-chat prefs, normalize SDK lifecycle statuses, and surface companion start failures (including database locks) without infinite silent load.

## Requirements
### Requirement: Companion MCP status is available to the chat UI
The system MUST expose companion OpenCode MCP connection status to the webview without mutating global or project `opencode.json`. Status MUST be read from the chat companion process only.

#### Scenario: Host returns companion MCP status
- **WHEN** the webview sends `{ type: "getMcpStatus" }`
- **THEN** the extension host MUST call the companion agent `getMcpStatus()`
- **AND** MUST post `{ type: "mcpStatus"; status }` where `status` maps server names to objects that include a boolean `connected` field

#### Scenario: MCP unavailable
- **WHEN** the agent does not advertise MCP capability, or status fetch fails
- **THEN** the UI MUST not crash
- **AND** MUST either hide the MCP section or show an empty/error state without writing config

### Requirement: User can toggle companion MCP connections from settings
The chat settings panel MUST list companion-discovered MCP servers and allow the user to connect or disconnect each server on the companion process only. Toggles MUST NOT write `opencode.json` and MUST NOT affect an independently running TUI process.

#### Scenario: Enable a disconnected server
- **WHEN** the user checks an MCP server that is currently disconnected
- **THEN** the webview MUST send `{ type: "connectMcp"; server: "<name>" }`
- **AND** the host MUST call companion `connectMcp("<name>")`
- **AND** subsequent status MUST report that server as `connected: true` when the RPC succeeds

#### Scenario: Disable a connected server
- **WHEN** the user unchecks an MCP server that is currently connected
- **THEN** the webview MUST send `{ type: "disconnectMcp"; server: "<name>" }`
- **AND** the host MUST call companion `disconnectMcp("<name>")`
- **AND** subsequent status MUST report that server as `connected: false` when the RPC succeeds

#### Scenario: Toggle failure
- **WHEN** connect or disconnect fails
- **THEN** the host MUST surface an error via the existing host error path
- **AND** the UI MUST refresh or retain accurate connection state without writing config files

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

#### Scenario: First run with no preferences
- **WHEN** host and webview stores for `mcpEnabledByServer` are absent or
  empty
- **THEN** the startup overlay MUST mark all inherited servers disabled
- **AND** the first user toggle MUST store that server's preference key in
  both the host and webview stores

#### Scenario: Re-apply saved preferences on ready
- **WHEN** the chat UI becomes ready and saved preferences contain known server keys
- **THEN** for each server present in both live status and preferences with `true`, the system MUST connect if not connected
- **AND** for each server present in both with `false`, the system MUST disconnect if connected
- **AND** preference keys that do not appear in live status MUST be ignored for re-apply

#### Scenario: Preferences survive companion and host restarts
- **WHEN** the user sets MCP preferences and the Chat companion or the VS
  Code extension host restarts
- **THEN** the preferences MUST still be available from workspace-scoped
  host state
- **AND** the startup overlay MUST be built from those preferences before
  the companion launches
- **AND** re-apply MUST run again after ready

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

### Requirement: Settings panel UX for MCP
The gear `ToolConfigPanel` MUST include an MCP section when companion MCP is supported. The section MUST use checkboxes (or equivalent toggles) bound to connection state and preference updates. Language selection MUST use a compact control (dropdown/select), not a long radio list, while preserving all previous locale options and the sound/config-link sections.

#### Scenario: Panel lists servers
- **WHEN** companion status includes one or more MCP servers
- **THEN** the MCP section MUST render one toggle control per server name reflecting current `connected` state

#### Scenario: Empty inventory
- **WHEN** companion status is empty after a successful status response
- **THEN** the MCP section MUST show an empty-state message
- **AND** MUST still allow access to project/global config links already in the panel footer

#### Scenario: Trust notice
- **WHEN** the MCP section is visible
- **THEN** the UI MUST show a short trust notice that user-installed MCP tools are not restricted by Scout edit/bash denials

#### Scenario: Language control is compact
- **WHEN** the settings panel is open
- **THEN** locale selection MUST be a single dropdown/select control exposing the same locale options previously kept as radios

### Requirement: SDK MCP status is normalized for the UI
The system MUST map OpenCode SDK MCP lifecycle statuses into domain objects with an explicit boolean `connected` derived from the lifecycle (true only when status is connected).

#### Scenario: Connected SDK status maps to connected true
- **WHEN** companion `/mcp` returns a server entry `{ status: "connected" }`
- **THEN** domain status for that server MUST have `connected: true` and `status: "connected"`

#### Scenario: Non-connected SDK statuses map to connected false
- **WHEN** companion `/mcp` returns a server entry with status `disabled`, `failed`, `needs_auth`, or `needs_client_registration`
- **THEN** domain status for that server MUST have `connected: false`
- **AND** MUST preserve the lifecycle value and any error string for UI display when present

### Requirement: Companion server start failure is user-visible
When the companion OpenCode server fails to start, the extension MUST NOT leave the chat view permanently blank without feedback. Failures that include project database lock contention (`database is locked`) MUST instruct the user that another OpenCode process may hold the project DB.

#### Scenario: Database locked fails activation path with message
- **WHEN** `createOpencodeServer` / companion connect fails with output that indicates `database is locked`
- **THEN** the extension MUST show a VS Code error or warning with remediation text
- **AND** MUST NOT rewrite `opencode.json`
- **AND** SHOULD still register the chat webview provider (or otherwise avoid infinite load without feedback)

#### Scenario: Other connect failures
- **WHEN** companion connect fails for a non-ENOENT reason other than silent success
- **THEN** the extension MUST surface the failure to the user
- **AND** MUST not hang indefinitely without any activation error or webview error surface

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
- **THEN** the startup overlay MUST mark the server disabled
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
