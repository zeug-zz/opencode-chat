# automatic-session-retention Specification

## Purpose

This capability enables approved provider lifecycle retention for companion Chat and Write sessions by default, while keeping automatic retention independently disableable, bounded, sandbox-aware, and unavailable when no safe provider is present.

## Requirements

### Requirement: Automatic retention is enabled by default for an approved provider

The companion SHALL resolve automatic session retention as enabled by default when the workspace has no invalid or explicit disable setting. The effective automatic policy SHALL remain independent from explicit user-requested retention and from recall/reflect tool availability. When no approved usable provider is available, the enabled policy SHALL be a no-op and SHALL not block ordinary Chat, Write, AGENTS.md, or workspace-context behavior.

#### Scenario: First use with an approved usable provider

- **WHEN** a workspace has no automatic-retention setting and the companion resolves an exact approved provider that supports verified lifecycle retention
- **THEN** automatic session retention SHALL be active by default for supported companion sessions
- **AND** explicit retention SHALL retain its separate enablement and confirmation policy
- **AND** recall and reflect capabilities SHALL remain independently represented

#### Scenario: First use without a provider

- **WHEN** a workspace has no automatic-retention setting and no approved usable provider is available
- **THEN** the effective automatic policy SHALL remain enabled but SHALL perform no provider operation
- **AND** the companion SHALL remain usable with ordinary context and applicable AGENTS.md guidance
- **AND** no provider plugin or lifecycle operation SHALL be initialized

#### Scenario: User explicitly disables automatic retention

- **WHEN** the workspace automatic-retention setting is explicitly false
- **THEN** automatic session retention SHALL be disabled for the companion process
- **AND** explicit user-requested retention SHALL remain independently configurable
- **AND** the independent OpenCode TUI lifecycle configuration SHALL not be changed

### Requirement: Lifecycle retention is gated by approved provider and sandbox capability

Automatic retention SHALL activate only after the provider passes the existing exact identity, capability, observed-inventory, lifecycle-support, and sandbox-path checks. The companion SHALL use a process-scoped lifecycle configuration for its own server and SHALL never inherit unrelated global plugins or alter the independent TUI configuration. A provider that is unavailable, blocked, errored, unverified, or outside the approved integration boundary SHALL not receive automatic-retention startup.

#### Scenario: Approved Hindsight lifecycle is activated

- **WHEN** the exact approved Hindsight integration is resolved
- **AND** its companion lifecycle-retention support passes the provider verification contract
- **AND** the requested sandbox policy can grant only its exact required runtime/configuration paths
- **AND** automatic retention is enabled
- **THEN** the companion process SHALL activate the provider-native lifecycle retention path
- **AND** it SHALL not set the companion’s lifecycle-suppression flag
- **AND** the TUI process and its configuration SHALL remain unchanged

#### Scenario: Lifecycle retention is disabled or unsafe

- **WHEN** automatic retention is disabled, provider identity/capability verification fails, required paths are unsafe, or the provider is blocked/error/unavailable
- **THEN** the companion SHALL suppress provider lifecycle retention for its process
- **AND** it SHALL not retry by weakening or removing the sandbox
- **AND** ordinary Chat/Write startup and existing safe recall/reflect behavior SHALL continue when available

### Requirement: Automatic retention preserves bounded privacy boundaries

Automatic lifecycle retention SHALL retain only provider-supported bounded session summaries. It SHALL exclude credentials, secrets, authorization material, raw tool payloads, complete large documents, untrusted web pages, unrelated private workspace content, provider configuration, and sandbox diagnostics. The companion SHALL not expose raw retained content, provider payloads, or credentials through the webview, status protocol, logs, or errors.

#### Scenario: Completed session produces a safe bounded retention

- **WHEN** a supported Chat or Write session reaches the provider’s completed/idle retention boundary
- **THEN** the provider SHALL receive at most one bounded summary for that session
- **AND** the summary SHALL exclude the prohibited content classes
- **AND** repeated lifecycle notifications SHALL not create duplicate automatic retention for the same session

#### Scenario: Empty, oversized, or unsafe session content

- **WHEN** a session has no meaningful bounded summary or its candidate content contains prohibited or unsafe material
- **THEN** automatic retention SHALL skip that session or retain only the provider-approved sanitized summary
- **AND** the companion SHALL remain usable
- **AND** it SHALL not report an unsafe or skipped retention as successful durable storage

### Requirement: Automatic retention failures are nonfatal and observable safely

A lifecycle-retention startup or write failure SHALL not prevent Chat or Write from starting, continuing, or returning to the AGENTS.md/context fallback. The companion SHALL expose only bounded provider-neutral automatic-retention state and reason information. It SHALL not claim that a session was retained unless the provider reports success.

#### Scenario: Provider lifecycle startup fails

- **WHEN** automatic-retention initialization fails after ordinary companion startup is otherwise possible
- **THEN** the companion SHALL keep the requested sandbox mode and ordinary agent permissions
- **AND** it SHALL disable or mark automatic retention unavailable for that process
- **AND** it SHALL surface a bounded non-success status without raw provider details

#### Scenario: Automatic retention write fails

- **WHEN** the provider rejects or fails an automatic session summary
- **THEN** the companion SHALL not emit a successful-retention state
- **AND** subsequent non-retention Chat/Write work SHALL remain usable
- **AND** the failure SHALL not trigger an unsandboxed retry or provider configuration write

### Requirement: Automatic retention applies consistently to companion launch paths

When automatic retention is active, the same provider lifecycle policy SHALL be applied to SDK-managed and sandboxed companion launches. When it is inactive, both launch paths SHALL suppress lifecycle retention. The lifecycle environment, provider reference, sandbox paths, agent permissions, MCP overlay, and guidance overlay SHALL remain process-scoped and parity-tested.

#### Scenario: Sandboxed and unsandboxed launch parity

- **WHEN** the same workspace/provider/policy is launched once through the SDK-managed path and once through the sandboxed child path
- **THEN** both paths SHALL agree on whether automatic retention is active
- **AND** both paths SHALL use the same exact provider identity and runtime/configuration read grants
- **AND** neither path SHALL inherit unrelated plugins or change the independent TUI

### Requirement: Automatic retention status is provider-neutral and independently surfaced

The typed host/UI status SHALL distinguish automatic retention active, disabled, unavailable, blocked, and error states independently from explicit retention and recall/reflect status. Status SHALL not include provider credentials, paths, raw payloads, lifecycle hook output, or unbounded errors.

#### Scenario: Status reports active automatic retention

- **WHEN** an approved provider passes lifecycle and sandbox checks and the effective automatic policy is enabled
- **THEN** the settings/status surface SHALL report automatic retention as active
- **AND** it SHALL continue to report explicit retention confirmation and recall/reflect capabilities separately
- **AND** the status SHALL contain only bounded provider-neutral fields
