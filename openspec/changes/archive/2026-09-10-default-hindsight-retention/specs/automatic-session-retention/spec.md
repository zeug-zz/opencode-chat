## MODIFIED Requirements

### Requirement: Automatic retention is enabled by default for an approved provider

The companion SHALL resolve automatic session retention as enabled whenever an
exact approved provider passes capability, observed-inventory, lifecycle, and
sandbox checks. There SHALL be no extension workspace setting or settings-panel
checkbox that disables the effective policy. When no approved usable provider is
available, the enabled policy SHALL be a no-op and SHALL not block ordinary Chat,
Write, AGENTS.md, or workspace-context behavior.

#### Scenario: First use with an approved usable provider

- **WHEN** the companion resolves an exact approved provider that supports
  verified lifecycle retention
- **THEN** automatic session retention SHALL be active by default
- **AND** no user retention setting SHALL be required
- **AND** explicit retention SHALL use the always-on, confirmation-required
  policy

#### Scenario: First use without a provider

- **WHEN** a workspace has no automatic-retention setting and no approved usable
  provider is available
- **THEN** the effective automatic policy SHALL remain enabled but SHALL perform
  no provider operation
- **AND** the companion SHALL remain usable with ordinary context and applicable
  AGENTS.md guidance
- **AND** no provider plugin or lifecycle operation SHALL be initialized

#### Scenario: User explicitly disables automatic retention

- **WHEN** the workspace automatic-retention setting is explicitly false
- **THEN** the companion SHALL ignore the legacy disable value and keep the
  provider-gated automatic policy enabled internally
- **AND** automatic retention SHALL still be a no-op when no approved usable
  provider is available
- **AND** the independent OpenCode TUI lifecycle configuration SHALL not be
  changed

#### Scenario: A legacy automatic-retention disable value exists

- **WHEN** the workspace contains a previously stored automatic-retention false
  value
- **THEN** the companion SHALL ignore it
- **AND** it SHALL not write or delete the stored setting
- **AND** automatic retention SHALL still be enabled after provider verification

#### Scenario: No verified provider is available

- **WHEN** no approved usable provider is available or sandbox-safe
- **THEN** the effective automatic policy SHALL remain internally enabled but
  SHALL perform no provider operation
- **AND** ordinary Chat, Write, and AGENTS.md behavior SHALL continue

### Requirement: Automatic retention status is provider-neutral and independently surfaced

The host SHALL retain enough provider-neutral automatic-retention state to gate
startup and report bounded diagnostics, but the removed retention settings
surface SHALL not expose automatic enablement controls or provider internals.
Automatic startup/write failures SHALL remain nonfatal and SHALL not trigger an
unsandboxed retry.

#### Scenario: Status remains bounded and internal

- **WHEN** automatic retention is active, unavailable, blocked, or errors
- **THEN** the host SHALL retain enough provider-neutral state to enforce the
  lifecycle policy and report bounded diagnostics
- **AND** the removed settings surface SHALL not expose provider paths,
  credentials, raw payloads, or lifecycle hook output

#### Scenario: Status reports active automatic retention

- **WHEN** an approved provider passes lifecycle and sandbox checks and the
  effective automatic policy is enabled
- **THEN** the host SHALL retain an active provider-neutral automatic-retention
  state for enforcement
- **AND** explicit retention confirmation and recall/reflect capabilities SHALL
  remain independent
- **AND** the removed settings surface SHALL not expose provider internals
