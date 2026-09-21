## MODIFIED Requirements

### Requirement: Keep bridge authority host-owned and dormant for ordinary Chat

The bridge SHALL not be exposed as an OpenCode plugin, MCP server, custom tool, agent/task target, or model-controlled route. It SHALL not edit global OpenCode configuration, AF configuration, nono profiles, user sandbox profiles, or ordinary workspace files. After activation, `extension.ts` MAY construct the bridge and proof store beneath extension global storage and preflight the pinned runtime at most once per extension activation using direct execution; availability SHALL depend only on compatibility and direct execution readiness, with no grant, denied-domain, or policy preflight. A caller SHALL still be unable to supply an executable, workspace, environment, or argv value. The existing unavailable manual-review controller SHALL remain the review-result fallback whenever the runtime is not ready.

#### Scenario: Ordinary Chat or a model asks to run AF

- **WHEN** an ordinary prompt, model output, Scout, Write, worker, or MCP path asks to invoke AF
- **THEN** no bridge operation SHALL be available through that path
- **AND** the existing Chat, Write, Scout, worker, MCP, reasoning-streaming, and TUI authority boundaries SHALL remain unchanged

#### Scenario: The bridge is constructed during activation

- **WHEN** the extension activates on a supported host
- **THEN** the host MAY construct the bridge, allocate the proof store beneath global storage, and preflight once
- **AND** a dormant or failed preflight SHALL leave the unavailable review flow and ordinary behavior unchanged

#### Scenario: Default activation and tests remain fixture-only

- **WHEN** the normal test suite runs or AF is absent
- **THEN** default activation and tests SHALL not require an AF binary, a nono installation or profile, network, or configuration mutation
- **AND** fixture and injected-seam tests SHALL still verify compatibility, bounded direct execution, and failure behavior
