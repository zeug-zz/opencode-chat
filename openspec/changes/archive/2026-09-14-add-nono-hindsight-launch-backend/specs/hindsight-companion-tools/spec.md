## MODIFIED Requirements

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

## ADDED Requirements

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
