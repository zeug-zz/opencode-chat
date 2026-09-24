## MODIFIED Requirements

### Requirement: Keep projection dormant and preserve security boundaries

Projection SHALL be host-owned and lazy. Ordinary activation, Chat, Write, Scout,
the research worker, MCP, the OpenCode agent interface, and the independent TUI
SHALL not gain AF or claim-projection authority beyond the constrained activation
wiring. This phase SHALL not modify workspace files, OpenCode/AF configuration,
nono profiles, user sandbox profiles, plugin sources, MCP configuration, or model
permissions. After activation, the host MAY inject the claim-projection controller
dynamically only when the pinned runtime is compatible, direct execution is
ready, and the bridge reports an explicitly supported claim operation; when the
claim capability is absent, the host SHALL retain the unavailable controller
and publish a bounded unavailable status, and when the runtime is dormant,
ordinary activation behavior SHALL be exactly as before.

#### Scenario: Ordinary activation does not request a review

- **WHEN** the extension activates or a normal Chat/Write interaction occurs
  without an explicit manual review request
- **THEN** no claim graph SHALL be compiled and no claim operation SHALL run
- **AND** the existing ordinary behavior and authority boundaries SHALL remain
  unchanged

#### Scenario: A model or tool asks to invoke claim projection

- **WHEN** a model, Scout, Write, worker, plugin, MCP server, or ordinary prompt
  requests a claim projection
- **THEN** no model-visible or agent-visible projection route SHALL exist
- **AND** only the existing host-owned manual review request may start the phase

#### Scenario: Configuration or profile changes would be required

- **WHEN** claim projection would require changing workspace/config/profile files,
  adding a plugin/MCP/tool, or broadening a sandbox permission
- **THEN** the phase SHALL remain unavailable
- **AND** those files, settings, permissions, and existing Chat behavior SHALL be
  left unchanged

#### Scenario: A ready runtime with a supported claim operation selects the projection controller

- **WHEN** activation resolves a compatible runtime with direct execution ready and the bridge reports an explicitly supported claim operation
- **THEN** the host MAY inject the claim-projection controller for manual review requests
- **AND** a dormant runtime or a runtime without a supported claim operation SHALL retain the unavailable controller with no projection attempt
