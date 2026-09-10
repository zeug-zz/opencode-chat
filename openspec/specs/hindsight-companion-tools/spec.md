# hindsight-companion-tools Specification

## Purpose

This capability gives the extension-owned Chat and Write agents capability-gated access to the approved Hindsight recall/search, reflection, and confirmation-gated retention tools while preserving the companion’s existing isolation, fallback, and sandbox boundaries.

## Requirements

### Requirement: Load only the approved Hindsight integration

The companion MAY inherit the native OpenCode plugin surface, but SHALL identify
at most one Hindsight integration by the exact approved Hindsight coding-agent
package identity. It SHALL resolve the configured entry without executing
arbitrary plugins. Plugin entries and their options SHALL remain opaque to the
extension. It SHALL use that identity only for Hindsight capability,
observed-tool inventory, lifecycle, retention, sandbox-path, and exact
permission gates. Unrelated or merely Hindsight-like plugins SHALL not gain
Hindsight authority.

#### Scenario: Approved Hindsight entry is configured

- **WHEN** the effective OpenCode configuration contains an entry that resolves to the approved Hindsight coding-agent package
- **THEN** the companion SHALL use only that entry for Hindsight integration
- **AND** unrelated inherited plugin entries SHALL not participate in Hindsight capability, observed-tool inventory, lifecycle, retention, or path gating
- **AND** the independent TUI configuration SHALL remain unchanged

#### Scenario: Approved Hindsight entry is configured with other plugins

- **WHEN** the effective OpenCode configuration contains the approved Hindsight
  entry and unrelated user plugins
- **THEN** the companion MAY load the native plugin set
- **AND** only the exact approved Hindsight entry SHALL participate in Hindsight
  capability detection and retention policy
- **AND** the independent TUI configuration SHALL remain unchanged

#### Scenario: Hindsight-like but unapproved entry is configured

- **WHEN** a configured plugin name or path merely contains a Hindsight-like string but does not resolve to the exact approved package identity
- **THEN** the companion SHALL not load it as Hindsight
- **AND** no Hindsight tool SHALL be exposed
- **AND** normal Chat and Write operation SHALL remain available

### Requirement: Unrelated plugins cannot gain Hindsight authority

Only the exact approved Hindsight identity and independently verified observed
tool inventory SHALL participate in Hindsight capability, lifecycle, retention,
and path gates. Unrelated or merely Hindsight-like inherited plugins SHALL not
gain Hindsight administration, deletion, synchronization, or unknown authority.

#### Scenario: Unrelated plugin cannot impersonate Hindsight authority

- **WHEN** an inherited plugin exposes Hindsight-like names, administration, deletion, synchronization, or unknown tools
- **THEN** those tools SHALL not be treated as Hindsight capabilities
- **AND** only the exact approved identity and independently verified observed inventory SHALL participate in Hindsight gates

### Requirement: Gate Hindsight tools by detected capabilities

The companion SHALL expose only exact, non-administrative Hindsight tool names that correspond to detected capabilities. A detected `recall` capability SHALL allow `hindsight_search_knowledge_pages`, `hindsight_list_knowledge_pages`, and `hindsight_read_knowledge_page`; a detected `reflect` capability SHALL allow `hindsight_reflect`. The companion SHALL not use a broad `hindsight_*` wildcard.

The companion SHALL expose `hindsight_ingest_document` only when `retain: true` and the exact operation is observed, and SHALL keep `hindsight_capture_initiative`, `hindsight_diagnose`, `hindsight_sync_status`, deletion tools, provider administration, and unknown Hindsight tool names unavailable. Explicit retention SHALL remain confirmation-gated and automatic session retention SHALL remain bounded and provider/lifecycle/sandbox-gated.

#### Scenario: Fully capable Hindsight provider

- **WHEN** the approved provider is loaded and detection reports `recall: true`, `reflect: true`, and `retain: true` with the exact observed tools
- **THEN** Chat and Write SHALL receive the exact recall/search and reflection allows
- **AND** the exact retention operation SHALL remain confirmation-gated
- **AND** the provider’s diagnostic, synchronization, deletion, administration, and unknown tools SHALL remain denied

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

When the companion is sandboxed, Hindsight and all other inherited plugins SHALL
use the existing generic compatibility filesystem policy. The integration SHALL
not grant the home-directory root, broad credential directories, unrestricted
writes, plugin-specific write exceptions, or new unsandboxed fallback behavior.
Any protected-path conflict, unsupported runtime requirement, or unsafe path
resolution SHALL fail closed and report Hindsight as blocked or unavailable while
preserving ordinary Chat and Write operation.

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
