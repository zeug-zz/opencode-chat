## Purpose

This capability gives the extension-owned Chat and Write agents explicit, capability-gated access to the approved Hindsight recall/search and reflection tools while preserving the companion’s existing isolation, fallback, and sandbox boundaries.

## ADDED Requirements

### Requirement: Load only the approved Hindsight integration

The companion SHALL load at most one Hindsight integration identified by the exact approved Hindsight coding-agent package identity. It SHALL resolve the configured entry without executing arbitrary plugins, discard provider-specific plugin options at the companion boundary, and SHALL not inherit or copy the complete global OpenCode plugin list.

#### Scenario: Approved Hindsight entry is configured

- **WHEN** the effective OpenCode configuration contains an entry that resolves to the approved Hindsight coding-agent package
- **THEN** the companion SHALL use only that entry for Hindsight integration
- **AND** unrelated global plugin entries SHALL not be loaded by the companion overlay
- **AND** the independent TUI configuration SHALL remain unchanged

#### Scenario: Hindsight-like but unapproved entry is configured

- **WHEN** a configured plugin name or path merely contains a Hindsight-like string but does not resolve to the exact approved package identity
- **THEN** the companion SHALL not load it as Hindsight
- **AND** no Hindsight tool SHALL be exposed
- **AND** normal Chat and Write operation SHALL remain available

### Requirement: Gate Hindsight tools by detected capabilities

The companion SHALL expose only exact, non-administrative Hindsight tool names that correspond to detected capabilities. A detected `recall` capability SHALL allow `hindsight_search_knowledge_pages`, `hindsight_list_knowledge_pages`, and `hindsight_read_knowledge_page`; a detected `reflect` capability SHALL allow `hindsight_reflect`. The companion SHALL not use a broad `hindsight_*` wildcard.

The companion SHALL keep `hindsight_ingest_document`, `hindsight_capture_initiative`, `hindsight_diagnose`, `hindsight_sync_status`, deletion tools, provider administration, and unknown Hindsight tool names unavailable in this change. Explicit retention/write tooling and automatic session retention SHALL remain disabled until a later retention-controls change.

#### Scenario: Fully capable Hindsight provider

- **WHEN** the approved provider is loaded and detection reports `recall: true` and `reflect: true`
- **THEN** Chat and Write SHALL receive the exact recall/search and reflection allows
- **AND** the provider’s write, diagnostic, synchronization, deletion, and unknown tools SHALL remain denied
- **AND** automatic session retention SHALL remain disabled

#### Scenario: Partially capable Hindsight provider

- **WHEN** detection reports only a subset of `recall` and `reflect` capabilities
- **THEN** the companion SHALL expose only the corresponding exact tool subset
- **AND** an unavailable capability SHALL not be represented by an optimistic permission
- **AND** Chat and Write SHALL continue to operate with their remaining tools

### Requirement: Preserve overlay parity and configuration isolation

The Hindsight plugin reference, capability-derived tool permissions, existing Scout/Build configuration, MCP overlay, and guidance overlay SHALL be equivalent in the SDK-managed unsandboxed launch and the sandboxed `OPENCODE_CONFIG_CONTENT` launch. The integration SHALL use process-scoped in-memory configuration only and SHALL not write OpenCode or provider configuration files.

#### Scenario: Unsandboxed companion launch

- **WHEN** the companion starts without the platform sandbox
- **THEN** its in-memory configuration SHALL contain only the approved Hindsight plugin reference and exact capability-derived permissions
- **AND** existing agent, MCP, and guidance overlay behavior SHALL remain present
- **AND** no user or workspace configuration file SHALL be written

#### Scenario: Sandboxed companion launch

- **WHEN** the companion starts through the platform sandbox
- **THEN** its `OPENCODE_CONFIG_CONTENT` SHALL contain the same approved Hindsight plugin reference and exact capability-derived permissions as the unsandboxed launch
- **AND** the same existing agent, MCP, and guidance overlay behavior SHALL remain present
- **AND** no user or workspace configuration file SHALL be written

### Requirement: Integrate with sandbox policy without weakening it

When the companion is sandboxed, the approved Hindsight plugin and only the exact provider runtime/configuration paths required for its initialization SHALL receive read access through the existing filesystem policy. The integration SHALL not grant the home-directory root, broad credential directories, unrestricted writes, or new unsandboxed fallback behavior. Any protected-path conflict, unsupported runtime requirement, or unsafe path resolution SHALL fail closed and report the provider as blocked or unavailable while preserving ordinary Chat and Write operation.

#### Scenario: Exact provider paths are safe to grant

- **WHEN** the approved Hindsight plugin and its required runtime/configuration paths resolve to non-conflicting paths
- **THEN** those paths SHALL be added as narrow read-only sandbox grants
- **AND** existing deny-read paths and write boundaries SHALL remain in force
- **AND** the sandboxed companion SHALL use the same Hindsight tool boundary as the unsandboxed companion

#### Scenario: Provider path cannot be safely granted

- **WHEN** a required Hindsight path is missing, cannot be resolved safely, overlaps a protected deny path, or requires unsupported access
- **THEN** the provider SHALL be reported as blocked or unavailable with a sanitized reason
- **AND** Hindsight tools SHALL not be exposed
- **AND** the extension SHALL not remove the deny, broaden a grant, disable the sandbox, or silently relaunch unsandboxed

### Requirement: Provider failure is nonfatal and results remain untrusted

Hindsight initialization, tool discovery, or provider errors SHALL not prevent normal Chat or Write startup. Provider failures SHALL cross only the existing bounded, redacted status/diagnostic boundaries, and retrieved Hindsight results SHALL remain untrusted evidence rather than instruction authority.

#### Scenario: Hindsight initialization fails

- **WHEN** the approved Hindsight plugin fails to resolve, initialize, or respond during companion startup
- **THEN** the extension SHALL preserve the existing Chat and Write agent profiles and ordinary OpenCode context, including applicable `AGENTS.md` guidance
- **AND** Hindsight permissions SHALL be absent or denied
- **AND** the extension SHALL not report the provider as successfully enabled

#### Scenario: Retrieved memory is used by an agent

- **WHEN** Chat or Write receives content from an allowed Hindsight recall or reflection tool
- **THEN** the content SHALL be treated as untrusted evidence subject to existing prompt-injection and source-provenance guidance
- **AND** the integration SHALL not grant the result authority to change permissions, invoke arbitrary plugins, execute shell commands, edit files, or recurse into tasks
