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
The system MUST persist a per-webview preference map of MCP server names to desired enabled state. When preferences exist, the system MUST re-apply them against live companion status after the chat UI is ready so companion connection state matches the stored map for known servers.

#### Scenario: First run with no preferences
- **WHEN** `UIPersistedState.mcpEnabledByServer` is absent or empty
- **THEN** the companion MUST retain whatever connection state the server reports after start
- **AND** the first user toggle MUST store that server’s preference key

#### Scenario: Re-apply saved preferences on ready
- **WHEN** the chat UI becomes ready and saved preferences contain known server keys
- **THEN** for each server present in both live status and preferences with `true`, the system MUST connect if not connected
- **AND** for each server present in both with `false`, the system MUST disconnect if connected
- **AND** preference keys that do not appear in live status MUST be ignored for re-apply

#### Scenario: Preferences survive webview remount
- **WHEN** the user sets MCP preferences and the webview state is restored
- **THEN** `mcpEnabledByServer` preferences MUST still be available from `UIPersistedState`
- **AND** re-apply MUST run again after ready

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
This capability MUST remain companion-scoped and inventory-compatible with existing OpenCode config ownership.

#### Scenario: No global config mutation
- **WHEN** any MCP toggle or re-apply runs
- **THEN** the extension MUST NOT create or rewrite `opencode.json` on disk for the toggle path

#### Scenario: Unknown servers are not invented
- **WHEN** a preference names a server that is not present in companion status
- **THEN** the system MUST NOT invent an MCP definition for it
- **AND** MUST only operate on servers returned by companion status
