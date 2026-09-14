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
The companion SHALL expose only exact approved Hindsight operation names belonging to the exact approved provider and observed tool inventory; it SHALL not use a broad `hindsight_*` wildcard. The permitted subset SHALL additionally depend on the resolved companion backend.

When the companion is successfully launched through the verified nono backend, Chat and Write SHALL receive the exact observed approved Hindsight operation and confirmation surface supported by that provider. When the companion uses the VS Code compatibility sandbox because nono was unavailable before launch, Chat and Write SHALL receive only `hindsight_search_knowledge_pages`, `hindsight_list_knowledge_pages`, and `hindsight_read_knowledge_page` when recall is detected. In the fallback backend, `hindsight_reflect`, explicit writes, capture, diagnostics, synchronization, deletion, administration, unknown Hindsight tools, and automatic lifecycle operations SHALL remain unavailable.

#### Scenario: Nono-backed fully capable provider
- **WHEN** the approved provider is observed through a successfully launched nono backend
- **AND** its exact approved operations and confirmation semantics are observed
- **THEN** Chat and Write SHALL receive only that exact approved operation surface
- **AND** unknown, deletion, administrative, and unrelated-plugin tools SHALL remain denied

#### Scenario: Compatibility-sandbox fallback provider
- **WHEN** nono is unavailable before launch
- **AND** the companion uses the existing compatibility sandbox
- **AND** the approved provider reports recall with all three exact recall tools
- **THEN** Chat and Write SHALL receive only the three exact recall allows
- **AND** reflection, explicit writes, capture, diagnostics, synchronization, deletion, administration, unknown tools, and automatic lifecycle operations SHALL remain denied

#### Scenario: Recall capability is incomplete
- **WHEN** the fallback provider lacks one or more exact recall tools
- **THEN** the companion SHALL not expose an optimistic recall permission
- **AND** Chat and Write SHALL remain usable without Hindsight authority

#### Scenario: Fully capable Hindsight provider
- **WHEN** the approved provider is loaded through the verified nono backend
- **AND** detection reports its exact approved observed operations
- **THEN** Chat and Write SHALL receive only that exact operation and confirmation surface
- **AND** unobserved, deletion, administrative, and unrelated-plugin tools SHALL remain denied

#### Scenario: Partially capable Hindsight provider
- **WHEN** detection reports only a subset of supported operations in either backend
- **THEN** the companion SHALL expose only the corresponding backend-permitted exact subset
- **AND** an unavailable capability SHALL not be represented by an optimistic permission

### Requirement: Preserve overlay parity and configuration isolation
The extension SHALL use process-scoped in-memory configuration for both selected backends and SHALL not write OpenCode or provider configuration. The nono child and the compatibility-sandbox child SHALL retain the existing Scout/Build, MCP, guidance, workspace, and loopback overlays; their Hindsight permissions and lifecycle suppression SHALL follow their respective backend policy.

#### Scenario: Nono child receives the companion overlay
- **WHEN** the extension launches a nono-backed companion
- **THEN** its process-scoped overlay SHALL retain the companion agent, MCP, and guidance restrictions
- **AND** it SHALL not change user, workspace, or TUI configuration

#### Scenario: Fallback child suppresses full Hindsight behavior
- **WHEN** the extension launches the compatibility-sandbox fallback
- **THEN** its overlay SHALL suppress provider lifecycle hooks and full-Hindsight permissions
- **AND** it SHALL retain only the permitted recall surface when capability detection succeeds

#### Scenario: Unsandboxed companion launch
- **WHEN** the user explicitly starts the companion without Chat sandboxing
- **THEN** its in-memory configuration SHALL retain only the backend-permitted approved Hindsight permissions
- **AND** existing agent, MCP, and guidance overlays SHALL remain present
- **AND** no user or workspace configuration file SHALL be written

#### Scenario: Sandboxed companion launch
- **WHEN** the companion starts through either selected sandbox backend
- **THEN** its process-scoped overlay SHALL contain the corresponding exact approved Hindsight permissions
- **AND** existing agent, MCP, and guidance overlays SHALL remain present
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

### Requirement: Integrate Hindsight with the selected sandbox without policy reconstruction
The verified nono backend SHALL rely on its preflighted documented profile as the provider execution boundary and SHALL not copy profile-derived provider paths into the VS Code compatibility policy. The compatibility-sandbox fallback SHALL retain its existing generic policy and SHALL not receive provider-specific write, state, or broad home-directory grants merely to enable full Hindsight behavior.

#### Scenario: Nono provider state is native
- **WHEN** the approved Hindsight provider runs in the verified nono backend
- **THEN** its native provider state access SHALL be governed by the selected nono profile
- **AND** the extension SHALL not recreate that profile as a second filesystem policy

#### Scenario: Fallback provider requires unsupported state access
- **WHEN** full Hindsight would require provider state or write access outside the compatibility sandbox’s existing safe policy
- **THEN** the extension SHALL retain the recall-only fallback
- **AND** it SHALL not broaden filesystem grants, disable the sandbox, or relaunch unsandboxed
