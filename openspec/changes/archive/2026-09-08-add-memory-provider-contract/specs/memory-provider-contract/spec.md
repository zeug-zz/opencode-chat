## ADDED Requirements

### Requirement: Expose a provider-neutral memory contract

The project SHALL define provider-neutral memory operations, capability metadata, and provider descriptors that do not contain Hindsight-, Supermemory-, MCP-, or plugin-specific configuration details.

#### Scenario: Provider advertises supported capabilities

- **WHEN** a provider is represented by the shared contract
- **THEN** its descriptor SHALL identify a stable provider id and display name
- **AND** it SHALL independently describe retain, recall, reflect, and automatic-session-retention support
- **AND** it SHALL declare whether network or local runtime support is required
- **AND** provider-specific credentials, paths, URLs, payloads, and tool implementation details SHALL remain outside the shared descriptor

### Requirement: Support provider factories and safe selection

The agent layer SHALL provide an injectable provider-factory boundary that can discover a provider and create a normalized provider instance without loading arbitrary global plugins.

#### Scenario: A configured provider is selected

- **WHEN** an ordered provider factory reports a usable provider
- **THEN** the contract SHALL return that provider's normalized descriptor and capabilities
- **AND** selection SHALL be deterministic
- **AND** later factories SHALL not be invoked unnecessarily after a successful selection

#### Scenario: Provider discovery fails

- **WHEN** a provider factory throws or returns no usable provider
- **THEN** selection SHALL return a safe no-provider result or continue to the next factory
- **AND** the failure SHALL not prevent ordinary Chat or Write operation
- **AND** raw provider errors SHALL not cross the normalized boundary

### Requirement: Preserve an explicit no-provider fallback

The contract SHALL include a `none` provider representing ordinary OpenCode context and applicable AGENTS.md guidance without durable memory capabilities.

#### Scenario: No memory provider is available

- **WHEN** all configured provider factories are unavailable or blocked
- **THEN** the selected provider SHALL be `none`
- **AND** retain, recall, reflect, and automatic-session-retention SHALL all be false
- **AND** the result SHALL indicate that normal OpenCode context remains the fallback

### Requirement: Keep Hindsight provider-specific behavior behind an adapter boundary

The existing Hindsight detection SHALL be consumable through the provider-neutral boundary without exposing Hindsight tool names or enabling Hindsight tools, plugin inheritance, or automatic retention.

#### Scenario: Hindsight detection is available

- **WHEN** the Hindsight detector reports an available or partial status
- **THEN** the adapter SHALL produce normalized contract metadata
- **AND** it SHALL preserve the independently detected capability flags
- **AND** it SHALL not alter agent permissions, launch overlays, sandbox policy, MCP selection, or configuration files

### Requirement: Keep contract operations non-mutating in this change

The provider contract change SHALL be informational and construction-only until a later change explicitly enables memory tooling or retention.

#### Scenario: Contract is used during companion startup

- **WHEN** the companion constructs or selects a provider
- **THEN** it SHALL not load arbitrary global plugins
- **AND** it SHALL not write OpenCode or provider configuration
- **AND** it SHALL not perform retain, recall, reflect, delete, or automatic session-retention operations
- **AND** it SHALL preserve existing Chat, Write, and AGENTS.md behavior
