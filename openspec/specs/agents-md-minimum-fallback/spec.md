# agents-md-minimum-fallback Specification

## Purpose

This capability preserves applicable OpenCode `AGENTS.md` guidance and ordinary workspace context as the minimum fallback for Chat and Write when no safe durable-memory provider is usable.

## Requirements

### Requirement: Preserve applicable OpenCode guidance without a provider

Chat/Scout and Write/Build SHALL remain usable when no external memory provider exists. Each mode SHALL receive applicable OpenCode-discovered `AGENTS.md` guidance, ordinary workspace files, and normal request context.

#### Scenario: No provider with Chat and Write

- **WHEN** a checked-in project-local workspace/OpenCode fixture contains an applicable `AGENTS.md` with a distinctive marker and no memory provider is configured
- **THEN** Chat/Scout SHALL receive the discovered guidance and ordinary OpenCode context
- **AND** Write/Build SHALL receive the same applicable guidance and ordinary OpenCode context
- **AND** both modes SHALL continue normal request/message handling
- **AND** the test SHALL capture the actual OpenCode-assembled request/context; it SHALL NOT pass the marker as a mocked system or request option
- **AND** if the OpenCode SDK requires model execution to expose assembled context, the test MAY use a test-only in-process or localhost fake model transport owned by the test, using no credentials, external network, real memory provider, or provider/plugin startup
- **AND** no provider or plugin startup SHALL be attempted

### Requirement: Preserve the fallback for provider failure or disabled integration

The same AGENTS.md/context-only fallback SHALL remain available when provider detection is unavailable, blocked, errors, or memory integration is disabled.

#### Scenario: Provider unavailable, blocked, or errors

- **WHEN** deterministic provider detection reports unavailable, blocked, or error
- **THEN** Chat/Scout and Write/Build SHALL retain applicable discovered `AGENTS.md` and ordinary OpenCode context
- **AND** startup, prompts, permissions, sandbox mode, MCP behavior, and message handling SHALL remain unchanged
- **AND** the external provider SHALL not be a startup dependency

#### Scenario: Configured provider preflight fails or inventory is unavailable

- **WHEN** an exact approved provider is configured but its bounded preflight fails, required paths are blocked, registered-tool inventory is unavailable, or capability detection errors
- **THEN** the preflight failure SHALL be nonfatal
- **AND** ordinary Chat/Scout and Write/Build startup SHALL continue in the requested sandbox mode with the base AGENTS.md/context fallback
- **AND** no provider-backed capability or provider tool SHALL be exposed
- **AND** the preflight SHALL have been limited to the exact approved provider, process-scoped with lifecycle hooks disabled, non-mutating, and inventory-only
- **AND** the preflight SHALL not invoke recall, reflect, retain, or delete, automatic/lifecycle retention, or provider/OpenCode configuration writes
- **AND** any explicit base-launch reconstruction after these failures SHALL use a real base launch configuration without provider integration, so a helper default SHALL not restore the active provider

#### Scenario: Base launch is explicit after provider preflight failure

- **WHEN** approved-provider preflight fails, required paths are blocked, registered-tool inventory is unavailable, or capability detection errors
- **THEN** the fallback launch SHALL be reconstructed from the base launch configuration with no provider integration
- **AND** successful exact-provider preflight behavior SHALL remain unchanged
- **AND** the implementation MAY include only the smallest production/helper correction and focused regression tests needed to enforce this boundary

#### Scenario: Memory integration is disabled

- **WHEN** memory integration is disabled by its existing policy/settings
- **THEN** both Chat/Scout and Write/Build SHALL use the same AGENTS.md/context fallback
- **AND** the independent OpenCode TUI configuration SHALL remain untouched

### Requirement: Keep fallback status provider-neutral and context-only

Fallback status SHALL be provider-neutral and SHALL report retain, recall, reflect, and automatic-session-retention capabilities as disabled. It SHALL not be represented as a usable external provider.

#### Scenario: Fallback capabilities are inspected

- **WHEN** any no-provider, failed-provider, blocked-provider, or disabled fallback is selected
- **THEN** retain, recall, reflect, and automatic session retention SHALL all be false
- **AND** the status SHALL communicate context-only fallback semantics without provider credentials, paths, configuration, or raw errors

### Requirement: Prevent durable-memory and configuration side effects

Fallback paths SHALL perform no recall, reflect, retain, delete, lifecycle retention, plugin loading, provider configuration write, OpenCode configuration write, or external-provider startup operation.

#### Scenario: Negative side-effect checks run on every fallback path

- **WHEN** Chat or Write starts or handles a request under a fallback status
- **THEN** spies SHALL observe zero calls to durable-memory operations, lifecycle-retention hooks, provider loading outside the exact approved Hindsight preflight, and provider/configuration writes
- **AND** no provider/plugin startup SHALL be attempted when no provider is configured or memory integration is disabled
- **AND** if an exact approved provider is configured, the sole permitted provider loading SHALL be the existing bounded preflight needed to inventory tools, with lifecycle hooks disabled, no mutations, and no tool exposure before capability verification
- **AND** that preflight SHALL not invoke recall, reflect, retain, or delete, automatic/lifecycle retention, or provider/OpenCode configuration writes
- **AND** no new provider tool permission or sandbox/runtime grant SHALL be added
- **AND** the existing Chat and Write system guidance, permissions, sandbox mode, ordinary context, independent TUI configuration, and MCP behavior SHALL remain unchanged
- **AND** explicit base-launch reconstruction after approved-provider preflight failure, blocked paths, unavailable inventory, or detection error SHALL not be overridden by a default provider integration

### Requirement: Treat memory as evidence and guidance as project policy

Retrieved/provider content SHALL remain evidence rather than instruction. Applicable `AGENTS.md` SHALL remain the project-guidance source; this capability SHALL not write, promote, or treat durable memory as `AGENTS.md`.

#### Scenario: Maintained documentation describes the distinction

- **WHEN** users read the maintained Chat/Write and project documentation
- **THEN** it SHALL distinguish `AGENTS.md` guidance from durable cross-session memory
- **AND** it SHALL record that no-provider, disabled, and provider-failure paths retain the AGENTS.md/context fallback
