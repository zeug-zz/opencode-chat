# companion-plugin-runtime Specification

## Purpose

This capability keeps the extension-owned companion aligned with native OpenCode
plugin discovery while preserving launch-path parity, sandbox boundaries, and a
bounded plugin-free startup fallback.

## Requirements

### Requirement: Preserve native OpenCode plugin sources

The extension-owned companion SHALL load the native OpenCode plugin sources
available to the active global and project configuration, including configured
plugin entries and supported native plugin-directory discovery. Plugin entries,
tuple options, package names, local paths, and file URLs SHALL remain opaque to
the extension. The companion SHALL NOT copy unrelated OpenCode configuration or
execute plugin code during preflight solely to resolve plugin identity.

#### Scenario: Configured global plugin is available to the companion

- **WHEN** a user configures a valid plugin in the effective global OpenCode
  configuration
- **AND** the companion starts or restarts
- **THEN** the companion SHALL expose the plugin using the same native OpenCode
  loading semantics
- **AND** the extension SHALL not write or rewrite the global configuration

#### Scenario: Configured project plugin is available to the companion

- **WHEN** a project configuration supplies a valid plugin entry or tuple
  options
- **AND** the project is the active Chat workspace
- **THEN** the companion SHALL preserve the project plugin source and its options
- **AND** global plugin sources SHALL not be silently dropped

#### Scenario: Auto-discovered plugin directories remain native

- **WHEN** OpenCode's supported global or project plugin directory contains a
  valid plugin
- **AND** the companion starts with that workspace
- **THEN** the companion SHALL leave native directory discovery enabled
- **AND** the extension SHALL not implement a second package resolver or require
  a plugin-specific registration

#### Scenario: Plugin options remain opaque and unlogged

- **WHEN** a plugin entry includes configuration options
- **THEN** the companion launch SHALL preserve the entry needed by OpenCode
- **AND** diagnostics SHALL not log raw options, credentials, or serialized
  configuration content

### Requirement: Keep plugin loading equivalent across launch paths

The SDK-managed and sandboxed companion launch paths SHALL expose equivalent
native plugin sources, agent overlays, MCP overlays, guidance overlays, and
workspace context. The sandboxed path SHALL use the same process-scoped plugin
configuration without modifying user or project configuration files.

#### Scenario: SDK-managed and sandboxed launches have plugin parity

- **WHEN** the same workspace is launched once with the SDK-managed path and once
  with the sandboxed child path
- **THEN** both launches SHALL receive the same effective plugin sources
- **AND** both launches SHALL retain the same Scout, Build, worker, MCP, guidance,
  network, and workspace policies

#### Scenario: Independent TUI remains unchanged

- **WHEN** the companion loads inherited plugins
- **AND** an independent OpenCode TUI is started
- **THEN** the TUI SHALL use its normal native configuration and plugin lifecycle
- **AND** the extension SHALL not persist or alter companion overlay data in the
  TUI configuration

### Requirement: Plugin startup failure has a bounded safe fallback

If inherited plugin activation prevents the companion from reaching readiness,
the extension SHALL stop the failed companion and retry at most once with an
explicit plugin-free overlay. The retry SHALL preserve the requested sandbox
mode, network policy, agent permissions, MCP overlay, guidance overlay, and
workspace. The extension SHALL NOT remove protected sandbox denies or retry
unsandboxed solely because plugin loading failed.

#### Scenario: Plugin failure falls back to ordinary Chat

- **WHEN** an inherited plugin causes startup or readiness to fail
- **AND** the plugin-free companion can start in the requested sandbox mode
- **THEN** the extension SHALL keep Chat/Write usable with no inherited plugin
- **AND** the user SHALL receive only a bounded, redacted plugin-unavailable
  diagnostic

#### Scenario: Plugin and fallback startup both fail

- **WHEN** inherited plugin startup fails
- **AND** the plugin-free retry also fails
- **THEN** the extension SHALL use its existing bounded startup-error handling
- **AND** it SHALL not attempt an unsandboxed retry or write configuration

#### Scenario: Runtime plugin failure does not trigger broad fallback

- **WHEN** a plugin hook or plugin tool fails after the companion reaches
  readiness
- **THEN** the failure SHALL remain an operation-level failure
- **AND** the extension SHALL not broaden filesystem/network access or silently
  restart outside the requested policy

### Requirement: Inherited plugins remain subject to the companion trust boundary

Inherited plugins SHALL execute inside the extension-owned companion process and
its active sandbox policy. The extension SHALL document that plugin code is user-
trusted process code, not an isolated MCP child. Plugin inheritance SHALL NOT
grant arbitrary agent-level edit, shell, task, package, terminal, deletion,
administration, or unknown-tool permissions.

#### Scenario: Plugin reads use compatibility policy

- **WHEN** a sandboxed plugin reads its source, dependency, or configuration
  outside a protected deny-read path
- **THEN** the compatibility filesystem policy SHALL permit the read without a
  plugin-name-specific grant
- **AND** the plugin SHALL remain inside the companion process boundary

#### Scenario: Plugin writes remain constrained

- **WHEN** a sandboxed plugin writes outside the active workspace or existing
  OpenCode/runtime/temp write paths
- **THEN** the sandbox SHALL deny the write
- **AND** the extension SHALL not add a broad home-directory or plugin-specific
  write grant automatically
