## Purpose

This capability gives the OpenCode Chat companion an optional, Chat-specific
filesystem and process sandbox with an explicit network-access choice, without
changing VS Code-wide agent behavior or independent OpenCode processes.

## ADDED Requirements

### Requirement: Chat sandbox settings support workspace inheritance

The extension SHALL expose `opencode-chat.chatSandbox.mode` with `inherit`,
`on`, and `off` values at workspace scope. The default SHALL be `inherit`.
The effective Chat sandbox state SHALL be `on` when mode is `on`, `off` when
mode is `off`, and SHALL follow the effective VS Code
`chat.agent.sandbox.enabled` value when mode is `inherit`.

The extension SHALL expose `opencode-chat.chatSandbox.allowNetwork` at
workspace scope with a default of `true`. This setting SHALL apply only when
the effective Chat sandbox state is `on` and SHALL remain independent of VS
Code's `chat.agent.sandbox.allowNetwork` setting.

#### Scenario: Inherit follows native sandbox state

- **WHEN** `opencode-chat.chatSandbox.mode` is `inherit`
- **AND** the effective VS Code sandbox-enabled setting is `on`
- **THEN** the Chat companion SHALL start sandboxed
- **AND** Chat network access SHALL default to enabled unless the workspace
  explicitly sets `opencode-chat.chatSandbox.allowNetwork` to `false`

#### Scenario: Inherit preserves normal Chat when native sandbox is off

- **WHEN** `opencode-chat.chatSandbox.mode` is `inherit`
- **AND** the effective VS Code sandbox-enabled setting is `off`
- **THEN** the Chat companion SHALL start unsandboxed
- **AND** the Chat network setting SHALL have no effect

#### Scenario: Workspace on override enables Chat locally

- **WHEN** the effective VS Code sandbox-enabled setting is `off`
- **AND** the workspace sets `opencode-chat.chatSandbox.mode` to `on`
- **THEN** the Chat companion SHALL start sandboxed for that workspace
- **AND** other workspaces SHALL retain their own effective mode

#### Scenario: Workspace off override disables Chat locally

- **WHEN** the effective VS Code sandbox-enabled setting is `on`
- **AND** the workspace sets `opencode-chat.chatSandbox.mode` to `off`
- **THEN** the Chat companion SHALL start unsandboxed for that workspace
- **AND** the native VS Code sandbox setting SHALL remain unchanged

#### Scenario: Chat settings do not change Copilot policy

- **WHEN** a user changes either Chat sandbox setting
- **THEN** the extension SHALL change only the OpenCode Chat companion policy
- **AND** it SHALL NOT update `chat.agent.sandbox.enabled`
- **AND** it SHALL NOT update `chat.agent.sandbox.allowNetwork`
- **AND** it SHALL NOT change the sandbox behavior of other VS Code agents

### Requirement: Settings panel exposes Chat sandbox controls

The Chat settings panel SHALL display a `Sandbox Chat tools` control and a
visible `Allow network access` sub-control. The controls SHALL display the
effective Chat-specific settings and SHALL persist changes at workspace scope
through the extension's configuration mechanism rather than webview-only state.
When a workspace override is active, the panel SHALL provide a way to reset
the mode to `inherit`.

#### Scenario: User enables the Chat sandbox in a workspace

- **WHEN** the user checks `Sandbox Chat tools`
- **THEN** the extension SHALL persist
  `opencode-chat.chatSandbox.mode` as `on` for the active workspace
- **AND** the companion SHALL transition to the sandboxed mode
- **AND** the panel SHALL show the active sandbox status

#### Scenario: User disables the Chat sandbox in a workspace

- **WHEN** the user unchecks `Sandbox Chat tools`
- **THEN** the extension SHALL persist `opencode-chat.chatSandbox.mode` as `off`
  for the active workspace
- **AND** the companion SHALL transition to the unsandboxed mode
- **AND** the native VS Code sandbox settings SHALL remain unchanged

#### Scenario: User resets Chat mode to native inheritance

- **WHEN** the user selects `Use VS Code setting` or equivalent reset action
- **THEN** the extension SHALL remove the active workspace mode override
- **AND** the effective Chat sandbox state SHALL follow the native setting
- **AND** the panel SHALL indicate that the mode is inherited

#### Scenario: User enables Chat network access

- **WHEN** Chat sandboxing is enabled
- **AND** the user checks `Allow network access`
- **THEN** the extension SHALL persist
  `opencode-chat.chatSandbox.allowNetwork` as `true`
- **AND** the sandboxed companion SHALL be allowed outbound network access
- **AND** the panel SHALL clearly indicate that filesystem restrictions remain
  active while network access is unrestricted

#### Scenario: User chooses local-only Chat operation

- **WHEN** Chat sandboxing is enabled
- **AND** the user leaves `Allow network access` unchecked
- **THEN** the companion SHALL remain sandboxed
- **AND** non-loopback outbound network requests from the companion process
  tree SHALL be denied
- **AND** local Chat operations SHALL remain available where filesystem policy
  permits them

### Requirement: Sandboxed companion process tree

When Chat sandboxing is enabled, the OpenCode companion server SHALL run inside
the platform sandbox and every shell tool, local MCP process, LSP, formatter,
or other child process launched by that server SHALL inherit the same
restrictions. The VS Code extension host and webview SHALL remain outside the
sandbox.

#### Scenario: Companion tools inherit the sandbox

- **WHEN** the sandboxed companion launches a shell tool or local MCP process
- **THEN** the child process SHALL inherit the companion filesystem and network
  restrictions
- **AND** the child SHALL NOT gain access merely because it was launched by
  OpenCode

#### Scenario: Extension host remains available

- **WHEN** Chat sandboxing is enabled
- **THEN** the extension host SHALL continue to perform VS Code UI operations
  such as opening editors, showing diffs, and communicating with the webview
- **AND** the sandbox policy SHALL not be applied to unrelated VS Code
  extensions

#### Scenario: Loopback Chat connection remains functional

- **WHEN** the sandboxed companion binds its local API server
- **THEN** it SHALL bind to loopback only
- **AND** the extension host SHALL be able to connect to that loopback server
- **AND** the sandbox SHALL not expose the companion API to non-loopback
  inbound connections

### Requirement: Sandboxed filesystem policy

The sandboxed companion SHALL be able to read and write the active workspace
and the minimum OpenCode configuration, session, runtime, cache, and temporary
paths required for Chat operation. It SHALL deny access outside explicitly
allowed paths, except for platform paths required by the sandbox runtime.

#### Scenario: Workspace access is preserved

- **WHEN** the Chat companion is sandboxed
- **THEN** permitted workspace reads and writes SHALL continue to work
- **AND** the existing Scout and Build agent permission behavior SHALL remain
  unchanged

#### Scenario: Outside filesystem access is denied

- **WHEN** a companion shell or MCP process attempts to read or write a path
  outside the allowed policy
- **THEN** the operation SHALL fail at the sandbox boundary
- **AND** the extension SHALL not broaden the policy automatically

#### Scenario: Required runtime paths are unavailable

- **WHEN** OpenCode or an enabled MCP requires a path that is not allowed
- **THEN** the affected operation SHALL report a visible failure
- **AND** the extension SHALL not replace the missing permission with broad
  home-directory access

### Requirement: Explicit Chat network policy

The Chat sandbox SHALL distinguish filesystem isolation from network access.
When `allowNetwork` is `false`, non-loopback outbound network access SHALL be
denied. When `allowNetwork` is `true`, outbound network access SHALL be
permitted while filesystem restrictions remain active. Non-loopback inbound
access SHALL remain denied in both modes.

#### Scenario: Provider request without network access

- **WHEN** Chat sandboxing is enabled
- **AND** Chat network access is disabled
- **AND** OpenCode attempts to contact a remote model provider
- **THEN** the request SHALL fail with a network or sandbox error
- **AND** the companion SHALL remain sandboxed

#### Scenario: Research request with network access

- **WHEN** Chat sandboxing and network access are enabled
- **AND** OpenCode performs a provider, web research, or remote MCP request
- **THEN** outbound network access SHALL be available to the companion process
  tree
- **AND** the request SHALL not require an unsandboxed retry

#### Scenario: Network denial is not bypassed

- **WHEN** a sandboxed OpenCode tool encounters a denied network request
- **THEN** the extension SHALL surface the tool failure
- **AND** it SHALL NOT retry the request outside the sandbox automatically

### Requirement: Companion reconfiguration is safe

Changing the effective Chat sandbox mode or Chat network setting SHALL apply to
the Chat companion without leaving the old process running alongside the new
process. The extension SHALL prevent new Chat operations during the transition
and SHALL restore normal Chat initialization after a successful restart.

#### Scenario: Enabling sandboxing while Chat is running

- **WHEN** the user changes the effective Chat sandbox mode from `off` to `on`
- **OR** the user changes the active workspace mode from `off` to `inherit`
  while the native sandbox is enabled
- **THEN** the extension SHALL stop the existing companion before starting the
  sandboxed companion
- **AND** it SHALL not leave an unsandboxed companion serving Chat requests
- **AND** it SHALL refresh the webview with the new sandbox status

#### Scenario: Disabling sandboxing while Chat is running

- **WHEN** the user changes the effective Chat sandbox mode from `on` to `off`
- **OR** the user changes the active workspace mode from `on` to `inherit`
  while the native sandbox is disabled
- **THEN** the extension SHALL stop the sandboxed companion before starting the
  unsandboxed companion
- **AND** the workspace override SHALL remain distinct from other workspaces
- **AND** the webview SHALL show that Chat is no longer sandboxed

#### Scenario: Changing network policy while sandboxed

- **WHEN** the user changes `opencode-chat.chatSandbox.allowNetwork`
- **THEN** the extension SHALL apply the new policy to the Chat companion
- **AND** it SHALL prevent requests from being sent while the transition is in
  progress
- **AND** it SHALL report the resulting effective status to the webview

#### Scenario: Sessions survive companion restart

- **WHEN** a successful sandbox setting change restarts the companion
- **THEN** persisted OpenCode sessions SHALL remain available
- **AND** the active session, messages, providers, agents, and MCP status SHALL
  be refreshed in the webview
- **AND** remembered Chat MCP preferences SHALL be reapplied to the new
  companion where the servers still exist

### Requirement: Sandbox failures fail closed

When Chat sandboxing is enabled, failure to initialize, start, connect to, or
maintain the sandboxed companion SHALL make Chat unavailable with a visible
error. The extension SHALL not silently fall back to an unsandboxed companion.

#### Scenario: Sandboxed startup fails

- **WHEN** the sandbox runtime or companion fails before readiness
- **THEN** the extension SHALL terminate any partial child process
- **AND** it SHALL show a meaningful Chat connection error
- **AND** it SHALL not start an unsandboxed replacement

#### Scenario: Sandboxed companion exits unexpectedly

- **WHEN** the sandboxed companion exits after becoming ready
- **THEN** the extension SHALL detect the lost process
- **AND** it SHALL report that Chat is unavailable
- **AND** it SHALL not silently launch an unsandboxed replacement

#### Scenario: User explicitly selects an unsandboxed Chat mode after failure

- **WHEN** the user explicitly selects `opencode-chat.chatSandbox.mode` as `off`
  after a sandboxed startup failure
- **THEN** the extension MAY restore the existing unsandboxed companion path
- **AND** the panel SHALL show the resulting disabled sandbox state

### Requirement: Existing Chat and independent process compatibility

When Chat sandboxing is disabled, existing companion behavior SHALL remain
compatible. This capability SHALL not change independent OpenCode CLI/TUI
processes, terminal handoff behavior, global or project OpenCode configuration
ownership, or VS Code-wide agent sandbox settings.

#### Scenario: Effective Chat sandbox is off

- **WHEN** the effective Chat sandbox mode is `off`
- **THEN** the companion SHALL retain its current SDK, Scout/Build, MCP,
  provider, session, and event behavior
- **AND** no sandbox runtime process SHALL be required

#### Scenario: Independent TUI is unaffected

- **WHEN** the user starts an independent OpenCode TUI process
- **THEN** the Chat sandbox setting SHALL not alter that process's startup,
  configuration, or permissions

#### Scenario: VS Code-wide sandbox settings are unaffected

- **WHEN** the user changes either Chat sandbox control
- **THEN** the effective behavior of Copilot and other VS Code agents SHALL not
  change
- **AND** the extension SHALL not write `chat.agent.sandbox.*` settings

### Requirement: Platform capability and policy boundaries

The Chat sandbox policy SHALL be independent of workspace selection and MCP
server identity: changing workspaces SHALL derive policy from the active
workspace and configured runtime paths, and enabling or disabling an MCP SHALL
not change the companion's isolation boundary except for explicitly required,
narrowly scoped paths. Local stdio MCP processes launched by the sandboxed
companion SHALL inherit the companion's filesystem, network, and process
restrictions. Remote MCP behavior SHALL follow the Chat sandbox network
policy; remote requests SHALL not receive a filesystem exemption.

On macOS, Mach permissions required for DNS resolution and TLS/provider
connectivity SHALL be implemented as platform-adapter details. They SHALL be
narrowly scoped to the required runtime behavior and SHALL not grant broad
wildcard network access, the whole home directory, or unrelated filesystem
paths. Linux SHALL use the sandbox runtime's Linux backend and SHALL not rely
on macOS Mach permissions.

The extension SHALL detect platform capability before advertising or starting
the sandbox. On unsupported Windows environments, the extension SHALL report
the sandbox as unsupported, SHALL keep Chat available through the existing
unsandboxed launch path, and SHALL NOT claim that the Chat sandbox is active.
This fallback SHALL not be presented as a Windows sandbox backend.

#### Scenario: Local stdio MCP inherits the companion policy

- **WHEN** a sandboxed companion starts a local stdio MCP
- **THEN** the MCP child SHALL inherit the companion sandbox restrictions
- **AND** an MCP-specific missing path SHALL produce a visible diagnostic
- **AND** the extension SHALL not grant broad home-directory or project-tree
  access to make the MCP start

#### Scenario: Remote MCP follows network policy

- **WHEN** a remote MCP is used by the sandboxed companion
- **THEN** its outbound behavior SHALL follow `allowNetwork`
- **AND** allowing remote network access SHALL not broaden filesystem access
- **AND** disabling network access SHALL not trigger an unsandboxed retry

#### Scenario: macOS adapter permits required DNS and TLS behavior narrowly

- **WHEN** macOS sandboxed Chat needs DNS resolution or TLS/provider traffic
- **THEN** the macOS adapter SHALL apply only the required Mach permissions
- **AND** it SHALL preserve the configured filesystem restrictions
- **AND** it SHALL not use broad wildcard permissions as a substitute

#### Scenario: Windows reports unsupported sandboxing gracefully

- **WHEN** Chat sandboxing is requested on an unsupported Windows environment
- **THEN** the status SHALL report sandbox support as unavailable
- **AND** Chat SHALL use the existing unsandboxed launch path
- **AND** the status SHALL not report effective sandboxing as enabled

### Requirement: Sandbox and MCP diagnostics are actionable

The extension SHALL preserve actionable diagnostics for sandbox violations and
MCP child failures, including the affected operation or child, relevant
startup/readiness context, exit status, and captured stderr/stdout subject to
existing secret-safety constraints. Diagnostics SHALL distinguish a denied
filesystem or network operation from a generic companion connection failure.

#### Scenario: Sandbox violation is visible without policy broadening

- **WHEN** the companion or an MCP child hits a sandbox-denied filesystem or
  network operation
- **THEN** Chat SHALL surface a diagnostic identifying the denied operation
- **AND** the companion SHALL remain under the configured sandbox policy
- **AND** the extension SHALL not retry outside the sandbox or silently widen
  permissions

#### Scenario: MCP child startup failure includes child diagnostics

- **WHEN** a local MCP child exits early or fails readiness
- **THEN** Chat SHALL report the MCP child identity and exit context
- **AND** available child stderr/stdout SHALL be included in the diagnostic
- **AND** secrets SHALL not be copied into user-visible diagnostics
