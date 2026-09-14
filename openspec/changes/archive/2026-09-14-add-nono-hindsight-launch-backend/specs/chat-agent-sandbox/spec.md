## MODIFIED Requirements

### Requirement: Sandboxed companion process tree
When Chat sandboxing is enabled, the extension SHALL run its OpenCode server and all of that server’s shell tools, local MCP processes, LSPs, formatters, and descendants inside the resolved sandbox backend. The resolved backend SHALL be either the verified external nono backend or the existing platform compatibility sandbox; the VS Code extension host and webview SHALL remain outside both. The extension SHALL not apply either policy to independent OpenCode processes.

#### Scenario: Nono companion descendants inherit its boundary
- **WHEN** the enabled Chat sandbox resolves the verified nono backend
- **THEN** the extension-owned OpenCode server and its local descendants SHALL run through the selected nono boundary
- **AND** the extension host and independent TUI SHALL remain outside that boundary

#### Scenario: Compatibility-sandbox descendants remain protected
- **WHEN** the enabled Chat sandbox resolves the existing compatibility backend
- **THEN** the companion and its local descendants SHALL retain the existing filesystem and network restrictions
- **AND** the extension SHALL not claim that nono is active

#### Scenario: Loopback Chat connection remains functional
- **WHEN** either sandbox backend starts the companion API server
- **THEN** it SHALL bind to loopback only
- **AND** the extension host SHALL be able to connect to that loopback server
- **AND** the sandbox SHALL not expose the companion API to non-loopback inbound connections

#### Scenario: Companion tools inherit the sandbox
- **WHEN** either enabled sandbox backend launches a shell tool or local MCP process
- **THEN** the child SHALL inherit the selected companion boundary
- **AND** it SHALL not gain access merely because OpenCode launched it

#### Scenario: Extension host remains available
- **WHEN** either sandbox backend is active
- **THEN** the extension host SHALL continue VS Code UI and webview operations
- **AND** the selected sandbox SHALL not apply to unrelated VS Code extensions

### Requirement: Sandbox failures fail closed
When an enabled Chat sandbox backend has been selected, failure to initialize, start, connect to, or maintain its companion SHALL make Chat unavailable with a visible bounded error. The extension SHALL terminate any partial child process and SHALL not silently start an unsandboxed replacement or change to a different sandbox backend. A preflight failure before any backend is selected may use the existing compatibility backend.

#### Scenario: Selected nono startup fails
- **WHEN** nono passed preflight and the selected nono companion fails during startup or readiness
- **THEN** Chat SHALL report the nono failure and remain unavailable
- **AND** it SHALL not start a compatibility-sandboxed or unsandboxed replacement

#### Scenario: Preflight falls back before launch
- **WHEN** nono is unavailable or unusable before a companion process is launched
- **THEN** the extension MAY start the existing compatibility sandbox
- **AND** it SHALL preserve that backend’s fail-closed behavior

#### Scenario: Sandboxed startup fails
- **WHEN** the selected sandbox backend or companion fails before readiness
- **THEN** the extension SHALL terminate any partial child process
- **AND** Chat SHALL show a meaningful backend-specific connection error
- **AND** it SHALL not start an unsandboxed replacement

#### Scenario: Sandboxed companion exits unexpectedly
- **WHEN** a selected sandboxed companion exits after readiness
- **THEN** Chat SHALL detect the lost process and report it unavailable
- **AND** it SHALL not silently launch another backend

#### Scenario: User explicitly selects an unsandboxed Chat mode after failure
- **WHEN** a user explicitly selects Chat sandbox mode off after a sandboxed failure
- **THEN** the extension MAY restore the existing unsandboxed companion path
- **AND** the panel SHALL show the disabled sandbox state

### Requirement: Sandboxed companion teardown is tree-complete
When a sandboxed Chat companion is stopped, disconnected, or replaced, the extension SHALL terminate the complete process group/tree owned by that companion and await bounded cleanup before starting a replacement. This SHALL include a nono wrapper or compatibility wrapper, OpenCode, local MCP processes, and runtime descendants. Teardown SHALL not terminate the independent TUI.

#### Scenario: Stopping a nono-backed companion
- **WHEN** a nono-backed Chat companion is stopped or reconfigured
- **THEN** the extension SHALL terminate its complete companion process tree before replacement
- **AND** local MCP descendants SHALL not remain running
- **AND** the independent TUI SHALL remain unaffected

#### Scenario: Stopping terminates the complete companion tree
- **WHEN** either sandboxed Chat companion is stopped or disconnected
- **THEN** the extension SHALL terminate its wrapper, OpenCode server, and descendants as one companion process tree
- **AND** it SHALL await cleanup before reporting teardown complete

#### Scenario: Stubborn descendants are forcefully cleaned up
- **WHEN** a companion process-tree member remains alive after bounded graceful termination
- **THEN** the extension SHALL forcefully terminate the remaining companion process group
- **AND** it SHALL await completion before replacement

#### Scenario: Reconnect waits for teardown
- **WHEN** sandbox or network configuration triggers a reconnect
- **THEN** the extension SHALL defer replacement until the prior companion tree is gone
- **AND** repeated transitions SHALL not accumulate descendants or race the project database

#### Scenario: Chat teardown does not terminate the TUI
- **WHEN** either sandboxed Chat companion is stopped or reconnected
- **THEN** the independent OpenCode CLI/TUI process tree SHALL remain unaffected
- **AND** the replacement SHALL retain its selected sandbox policy
