# memory-provider-registry Specification

## Purpose

This capability gives the companion a deterministic, provider-neutral way to register and select approved memory backends while preserving the no-provider AGENTS.md fallback and existing Hindsight security boundaries.

## Requirements

### Requirement: Register only approved provider adapters

The companion SHALL maintain an explicit registry of provider adapters supplied by the application boundary. A registered adapter SHALL expose a stable non-empty identifier, display name, normalized capabilities, and its provider-specific detection/selection behavior without placing provider tool names, credentials, paths, or payload formats in the shared protocol. The registry SHALL NOT load arbitrary plugins, import provider code named by user configuration, or inherit the independent TUI plugin list.

#### Scenario: Providers are registered deterministically

- **WHEN** the companion initializes its memory registry with approved adapters
- **THEN** adapters SHALL be addressable by their stable identifiers in registration order or an equally deterministic priority order
- **AND** duplicate identifiers, empty identifiers, malformed descriptors, and adapters that throw during registration SHALL not replace an already registered adapter
- **AND** registry construction SHALL not execute provider operations or write OpenCode/provider configuration

### Requirement: Select a provider through an explicit neutral policy

The registry SHALL support provider-neutral selection modes for automatic selection, the context-only `none` fallback, and an explicitly named registered provider. Automatic selection SHALL choose only a registered provider that is configured and passes its capability detection in deterministic priority order. An explicit unknown, disabled, unavailable, blocked, or failed provider selection SHALL resolve to a sanitized nonfatal fallback rather than selecting an unrequested provider.

#### Scenario: Automatic selection finds the first usable provider

- **WHEN** automatic selection is requested and multiple registered adapters are present
- **AND** an earlier adapter is unavailable while a later adapter is usable
- **THEN** the registry SHALL select the later usable registered adapter
- **AND** it SHALL not initialize or expose adapters after the selected provider
- **AND** the resulting descriptor and status SHALL be provider-neutral

#### Scenario: Explicit `none` selection preserves context-only operation

- **WHEN** the user or host selects the `none` provider
- **THEN** the registry SHALL return the immutable context-only descriptor
- **AND** retain, recall, reflect, and automatic session retention SHALL be disabled
- **AND** Chat/Scout and Write/Build SHALL continue with ordinary OpenCode context and applicable `AGENTS.md` guidance
- **AND** no external provider operation or plugin startup SHALL be attempted

#### Scenario: Explicit unknown or unusable selection fails closed

- **WHEN** an explicitly selected provider identifier is not registered or its detection reports unavailable, blocked, or error
- **THEN** the registry SHALL return a sanitized provider-neutral fallback/status
- **AND** it SHALL not silently substitute a different provider
- **AND** the independent TUI configuration, companion sandbox mode, and ordinary Chat/Write startup SHALL remain unchanged

### Requirement: Preserve capability and status separation

Registry results SHALL preserve retain, recall, reflect, and automatic-session-retention as independent capabilities. Automatic session retention SHALL remain disabled unless a later capability explicitly enables it; this change SHALL not enable lifecycle hooks or transcript retention. Status and failure reasons crossing the host/UI boundary SHALL be bounded and provider-neutral and SHALL not include credentials, provider paths, raw configuration, raw payloads, or unredacted provider errors.

#### Scenario: Partial provider capability is represented accurately

- **WHEN** a registered provider reports only a subset of retain, recall, or reflect capabilities
- **THEN** the selected result SHALL preserve each capability independently
- **AND** unavailable capabilities SHALL not be exposed as usable tools
- **AND** automatic session retention SHALL remain false

#### Scenario: Provider detection fails without breaking the companion

- **WHEN** a registered provider throws or returns an unsafe/unusable detection result
- **THEN** the registry SHALL produce a bounded sanitized failure/fallback result
- **AND** no provider-backed operation SHALL be invoked after the failure
- **AND** normal Chat/Write startup and the AGENTS.md/context fallback SHALL remain usable

### Requirement: Keep existing Hindsight behavior behind the registry

The existing approved Hindsight adapter SHALL be registered through the generic boundary without changing its exact package-identity check, observed-tool gating, sandbox read-path policy, `HINDSIGHT_DISABLE_HOOKS=1` lifecycle suppression, or explicit retention confirmation policy. The registry SHALL not broaden Hindsight permissions, add wildcard tools, inherit unrelated plugins, or modify the independent TUI.

#### Scenario: Hindsight remains the first approved provider

- **WHEN** the configured approved Hindsight integration is selected and passes its existing capability and inventory checks
- **THEN** the companion SHALL expose the same exact capability-derived Hindsight behavior as before
- **AND** the registry layer SHALL add no provider-specific tool names or paths to core types or the webview protocol
- **AND** provider preflight failure SHALL retain the existing same-sandbox fallback behavior

### Requirement: Support a replacement provider without Hindsight coupling

A provider adapter implementing the registry boundary SHALL be testable with a fake or replacement backend that uses no Hindsight-specific identifiers. Registering and selecting that adapter SHALL produce the same normalized descriptor/status shape and SHALL not require changes to Chat/Write permission profiles, AGENTS.md handling, or independent TUI configuration.

#### Scenario: Fake provider is registered and selected

- **WHEN** a test registers a fake provider with distinct retain, recall, and reflect capabilities and selects it explicitly
- **THEN** the registry SHALL return that provider’s normalized descriptor/status
- **AND** the fake provider SHALL be selectable without Hindsight package names, Hindsight tool patterns, or provider-specific fields in core
- **AND** the `none` fallback and existing Hindsight registration SHALL remain available
