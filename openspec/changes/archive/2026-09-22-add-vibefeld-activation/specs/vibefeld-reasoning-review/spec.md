## MODIFIED Requirements

### Requirement: Preserve existing authority boundaries in the scaffold

The scaffold contract itself SHALL NOT discover or launch an external runtime, create or write a proof workspace, create or modify configuration, add an OpenCode plugin source, MCP server, custom tool, or agent overlay, or change the permissions or sandbox policy of Chat, Scout, Write, the research worker, or the independent TUI. The activation change MAY replace the fixed unavailable-controller construction with the constrained, host-owned activation wiring defined by `vibefeld-activation` (pinned discovery, direct execution, mode-selected live parsers, global-storage proof store, one preflight, dynamic controller selection, availability-gated preference, and qualified routing). That substitution MUST NOT add any other runtime, plugin, MCP, custom tool, agent overlay, permission, or sandbox authority to the scaffold contract.

#### Scenario: Scaffold handles a review request

- **WHEN** the unavailable controller handles a manual review request and no runtime is ready
- **THEN** it SHALL not start a child process, access an AF executable, or write
  a proof workspace
- **AND** it SHALL not change configuration, launch configuration, plugin
  sources, MCP selection, agent permissions, or sandbox policy

#### Scenario: Existing Chat features are used without review

- **WHEN** the user does not request a reasoning review
- **THEN** existing Chat, Write, reasoning streaming, companion overlays,
  sandboxing, and independent TUI behavior SHALL remain unchanged

#### Scenario: Activation substitutes only the constrained contract wiring

- **WHEN** the activation change supplies the dynamic review controller and its host-owned wiring
- **THEN** only the documented discovery, direct-execution, parser, storage, preference, and qualified-routing paths SHALL be present
- **AND** plugin sources, MCP selection, custom tools, agent overlays, agent permissions, sandbox policy, and the independent TUI SHALL remain unchanged
