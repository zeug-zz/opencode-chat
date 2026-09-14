# nono-companion-launch-backend Specification

## Purpose
This capability selects and launches an external nono boundary for the extension-owned OpenCode server when it is available, while preserving a safe pre-launch fallback and accurate security semantics.

## Requirements

### Requirement: Deterministic companion sandbox backend selection
When the effective Chat sandbox mode is enabled on macOS or Linux, the extension SHALL resolve one backend before starting the companion: the supported external nono backend when its executable and the effective profile pass bounded preflight, otherwise the existing VS Code compatibility sandbox. The effective profile SHALL be the built-in `opencode` profile unless the user has explicitly selected a discovered custom user profile. When custom profiles are available on first sandbox-enabled use and no profile choice is stored, the extension SHALL offer a nonblocking picker to retain `opencode` or choose one custom profile; it SHALL persist only the resulting profile name through supported workspace settings and SHALL neither parse, copy, nor modify profile contents. Profile discovery SHALL use nono-supported introspection and the documented user-profile location (`$XDG_CONFIG_HOME/nono/profiles`, default `~/.config/nono/profiles`). The extension SHALL cache the resolved backend for the connection and its reconnects. A user-selected Chat sandbox mode of off SHALL retain the existing unsandboxed behavior and SHALL not be reported as nono-sandboxed.

#### Scenario: Valid nono preflight selects nono
- **WHEN** effective Chat sandboxing is enabled
- **AND** a supported nono executable and the effective `opencode` or explicitly selected custom profile pass bounded preflight
- **THEN** the extension SHALL select nono before starting OpenCode
- **AND** it SHALL report the companion as sandboxed by nono
- **AND** it SHALL not initialize the VS Code compatibility sandbox for that connection

#### Scenario: Nono is unavailable before launch
- **WHEN** effective Chat sandboxing is enabled
- **AND** nono is missing, non-executable, unsupported, or the effective profile fails preflight
- **THEN** the extension SHALL select the existing VS Code compatibility sandbox before launch
- **AND** it SHALL preserve that sandbox’s protected-read and write-containment behavior
- **AND** it SHALL not report nono as active

#### Scenario: Explicitly unsandboxed Chat remains unchanged
- **WHEN** the effective Chat sandbox mode is off
- **THEN** the extension SHALL preserve its existing unsandboxed companion behavior
- **AND** it SHALL not claim that nono is active
- **AND** it SHALL not change the independent TUI

#### Scenario: Custom profiles are offered but never auto-selected
- **WHEN** sandboxing is enabled, no profile choice is stored, and nono reports one or more custom user profiles
- **THEN** the extension SHALL offer the user `opencode` and those profiles as explicit choices
- **AND** it SHALL use `opencode` if the picker is dismissed or no custom profile is chosen
- **AND** it SHALL not silently select a custom profile

#### Scenario: No custom profile exists
- **WHEN** sandboxing is enabled and no custom user profile is discovered
- **THEN** the extension SHALL not prompt for profile selection
- **AND** it SHALL preflight and use `opencode` when supported nono is available

### Requirement: Nono launches the extension-owned server without shell interpolation
When nono is selected, the extension SHALL start only its own OpenCode server using the supported nono embedded launch form with separate argv elements and a non-shell spawn. The child SHALL retain the companion’s workspace, process-scoped in-memory overlay, loopback-only server arguments, bounded output handling, and existing agent/MCP restrictions. The extension SHALL not bundle or install nono and SHALL not write OpenCode, Hindsight, or nono configuration.

#### Scenario: Nono launch preserves companion isolation
- **WHEN** the extension starts the companion with nono selected
- **THEN** it SHALL launch nono with the explicit selected profile, argument separator, selected OpenCode executable, and existing serve arguments as separate argv values
- **AND** it SHALL retain the workspace cwd and process-scoped overlay
- **AND** the independent TUI and global configuration SHALL remain unchanged

#### Scenario: Paths contain shell-sensitive characters
- **WHEN** the workspace path, OpenCode path, or an argument contains spaces or shell-sensitive characters
- **THEN** the extension SHALL pass it as one argv value
- **AND** it SHALL not construct an interpolated shell command

### Requirement: Selected nono failures fail closed
After nono has been selected, a startup, readiness, policy, binding, or post-readiness failure SHALL leave Chat unavailable with a bounded, redacted backend-specific diagnostic. The extension SHALL terminate the partial companion process tree and SHALL not retry that connection through the VS Code sandbox or an unsandboxed server. A plugin-free retry, when applicable, SHALL retain nono.

#### Scenario: Nono fails during readiness
- **WHEN** a selected nono child fails before OpenCode readiness
- **THEN** the extension SHALL terminate the partial child process tree
- **AND** it SHALL report a bounded nono startup/readiness failure
- **AND** it SHALL not start a VS Code-sandboxed or unsandboxed replacement

#### Scenario: Plugin fallback under nono
- **WHEN** inherited plugin startup fails after nono has been selected
- **THEN** any permitted single plugin-free retry SHALL use the same nono backend
- **AND** it SHALL not retain Hindsight authority after the retry

### Requirement: Backend-specific lifecycle is cleaned up completely
The extension SHALL use the selected backend’s lifecycle APIs only for that backend and SHALL terminate the complete detached companion process group before reconnecting. A nono-backed connection SHALL not retain VS Code sandbox runtime state or violation-store assumptions.

#### Scenario: Reconnect replaces a nono companion
- **WHEN** a nono-backed companion is stopped or reconfigured
- **THEN** the extension SHALL wait for complete process-tree cleanup before replacement
- **AND** local MCP descendants SHALL not remain running
- **AND** the replacement SHALL use the previously resolved backend unless a new connection is explicitly resolved
