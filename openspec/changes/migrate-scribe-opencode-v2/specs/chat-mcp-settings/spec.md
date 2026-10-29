## ADDED Requirements

### Requirement: Apply MCP selection through a verified V2 policy and definition mechanism
Chat preferences SHALL affect only the Scribe child and never rewrite user config. Explicit selection SHALL enable ordinary user-config-disabled servers with complete transport definitions; inability to do so blocks migration. System/managed denials SHALL win; unselected local servers and unknown tools remain denied. Definitions are process-scoped; Scribe SHALL NOT persist or log secrets.

#### Scenario: Explicit Chat selection and config-disabled server
- **WHEN** a server is disabled by ordinary user configuration and explicitly selected in Chat
- **THEN** it is enabled with its complete definition through the verified V2 mechanism
- **AND** all higher-authority denials remain effective
- **AND** if the V2 mechanism cannot provide this behavior, this mandatory requirement remains blocking rather than optional

#### Scenario: Higher-authority policy denies a selected server
- **WHEN** Chat preference selects a server denied by system/managed policy
- **THEN** the denial wins, the server does not start/connect, and UI status does not claim it is enabled

#### Scenario: Unselected local server
- **WHEN** a local MCP is not selected for Chat
- **THEN** its child is not started where suppression is required, with both hermetic and inherited discovery evidence
- **AND** the user configuration remains unchanged

### Requirement: Preserve native MCP Code Mode selection
Selected complete MCP definitions MUST preserve native Code Mode defaults and explicit user settings.

#### Scenario: Native and explicitly disabled Code Mode settings
- **WHEN** selected complete MCP definitions are composed for the companion
- **THEN** omitted `codemode` retains native enabled-by-default behavior and explicit `codemode: false` remains false
- **AND** direct calls under false remain subject to normal permissions while Code Mode tests use enabled fixture servers
- **AND** system/user denials and native nested permissions remain effective
- **AND** tools are not unnecessarily duplicated as direct and Code Mode entries
- **AND** Scribe adds no dispatcher and copies no MCP schema dumps into its prompt
- **AND** a failed plugin or MCP integration stays on the same backend, gains no authority, and Code Mode is not claimed without the required research tools

## REMOVED Requirements

### Requirement: Chat launch MCP overlay carries no secrets
**Reason**: Names-plus-`enabled` alone is not a verified V2 contract and can lose required transport definitions or policy semantics.
**Migration**: Replace this assumption with the added V2 behavior requirement; retain no-config-write, no-secret diagnostics, policy-denial, and child-suppression invariants, and verify complete definitions and source authority before selecting an implementation.
The startup overlay MUST express server state using only server names and `enabled` boolean flags. It MUST NOT copy MCP commands, environment variables, headers, URLs, API keys, or any other server definition into the overlay content. The overlay MUST be delivered to the companion in memory only and MUST NOT be written to `opencode.json`, `.mcp.json`, or any config file on disk.

#### Scenario: Overlay contains only names and enabled flags
- **WHEN** the extension builds the launch overlay from a config whose MCP servers define commands, `env`/`environment` variables, headers, and API keys
- **THEN** the serialized overlay content MUST contain only entries shaped as `{ "<server-name>": { "enabled": true|false } }`
- **AND** it MUST NOT contain any command, environment variable, header, URL, API-key, or other definition value

#### Scenario: Overlay is never written to disk
- **WHEN** the companion is started with the overlay
- **THEN** the extension MUST NOT create or modify any OpenCode config file
- **AND** the overlay MUST exist only in the companion process configuration/env content

#### Scenario: Overlay content stays out of diagnostics
- **WHEN** companion or MCP diagnostics are produced after an overlay-filtered launch
- **THEN** the overlay payload MUST be redacted or absent from any user-visible diagnostic output

## MODIFIED Requirements

### Requirement: Chat MCP preferences are remembered and reapplied
The system MUST persist per-server Chat preferences in workspace host state and synchronize the webview store. It MUST apply preferences before private-child startup and converge against live status after ready. Ordinary config-disabled servers remain selectable; enforced system/managed denial is reported in `locked` and cannot be bypassed. The wire shape remains `{ prefs, locked }`; `locked` is not required to be empty.

#### Scenario: First run with no preferences
- **WHEN** host and webview stores for `mcpEnabledByServer` are absent or empty
- **THEN** the startup policy MUST disable all inherited servers for Chat
- **AND** the first user toggle MUST store that server preference in both host and webview stores

#### Scenario: Re-apply saved preferences on ready
- **WHEN** the chat UI becomes ready and saved preferences contain known server keys
- **THEN** each live server with preference `true` MUST connect unless a higher-authority denial locks it
- **AND** each live server with preference `false` MUST disconnect if connected
- **AND** unknown preference keys MUST be ignored

#### Scenario: Preferences survive companion and host restarts
- **WHEN** the user sets MCP preferences and Chat or the extension host restarts
- **THEN** preferences MUST remain available from workspace-scoped host state
- **AND** startup policy MUST apply them before launch and converge after ready

#### Scenario: Preferences survive webview remount
- **WHEN** the user sets preferences and webview state is restored
- **THEN** webview and authoritative host stores MUST retain the map and reapply it after ready

#### Scenario: Webview-only preferences migrate to host state
- **WHEN** Chat first becomes ready, host state is empty, and webview state has preferences
- **THEN** the host MUST adopt them and use host state on subsequent restarts

#### Scenario: Webview and host stores stay synchronized
- **WHEN** the user toggles a server in Gear
- **THEN** the webview MUST update immediately and notify the host, which persists the map

#### Scenario: Re-apply includes config-disabled servers selected in Chat
- **WHEN** a saved `true` preference selects an inventoried server disabled by ordinary user configuration
- **THEN** the system MUST connect it when live status reports disconnected
- **AND** it MUST preserve complete transport configuration and MUST NOT bypass a higher-authority denial
- **AND** `locked` MUST identify any higher-authority-denied server, while ordinary user-disabled servers are not locked

#### Scenario: Re-apply skips config-disabled servers
- **WHEN** a config-disabled server has no `true` Chat preference
- **THEN** the host MUST NOT connect it and it MUST remain disabled in Chat

### Requirement: Chat companion starts with unselected MCPs disabled
Before starting the companion, the extension MUST resolve complete V2 MCP definitions and apply a verified native V2 process-scoped policy that suppresses every unselected server. On first use all servers are unselected. The same effective policy applies to every backend, affects only the Scribe child, and cannot bypass higher-authority denials.

#### Scenario: First use starts zero MCP children
- **WHEN** Chat has no preferences and user/project config defines local MCP servers
- **THEN** the V2 child MUST start none of those servers and status MUST report them disabled

#### Scenario: Gear-panel selection starts only that server
- **WHEN** exactly one server is selected and the companion restarts
- **THEN** the selected server MUST start with its complete definition and all others remain disabled

#### Scenario: Selection survives companion restart
- **WHEN** saved preferences exist and the companion restarts or changes sandbox/network settings
- **THEN** selected permitted servers MUST reconnect and unselected servers remain disabled

#### Scenario: Sandboxed and unsandboxed launches filter identically
- **WHEN** the same workspace/preferences launch by either backend
- **THEN** both receive equivalent effective MCP policy and start only selected permitted servers

#### Scenario: Independent TUI is unaffected
- **WHEN** an independent CLI/TUI starts, including session handoff
- **THEN** it receives full user configuration unchanged and never receives the Chat overlay

### Requirement: OpenCode config disabled state is TUI-only for Chat
An ordinary user-config `enabled:false` MUST NOT prevent an explicit Chat selection from enabling the inventoried server. A system/managed policy denial MUST remain effective and be reported as locked; inability to enable the ordinary user-disabled selection through the selected V2 contract blocks migration. No user config file is rewritten and the independent TUI is unaffected.

#### Scenario: No Chat preference keeps a TUI-disabled server off in Chat
- **WHEN** an ordinary user config disables a server and no Chat preference selects it
- **THEN** the V2 Chat policy MUST keep it disabled and MUST NOT start its child

#### Scenario: Explicit Chat preference enables a TUI-disabled server
- **WHEN** ordinary user config disables an inventoried server and the user explicitly selects it in Chat
- **THEN** the V2 child MUST enable/connect it with the inherited complete definition
- **AND** a higher-authority denial MUST still block connection and be surfaced as locked
- **AND** if ordinary-disabled selection cannot be implemented, migration remains blocked

#### Scenario: Chat selection persists across companion and sandbox transitions
- **WHEN** a user-disabled server is selected and the companion restarts or changes backend mode
- **THEN** the saved selection MUST persist and reconnect unless higher-authority policy locks it

#### Scenario: TUI remains disabled and config files remain unchanged
- **WHEN** Chat selects a server disabled only in user config
- **THEN** an independent TUI MUST keep its configured disabled state
- **AND** config files MUST remain unchanged and the Chat overlay MUST not reach the TUI
