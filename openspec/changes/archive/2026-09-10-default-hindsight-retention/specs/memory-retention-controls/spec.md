## MODIFIED Requirements

### Requirement: Persist a safe workspace retention policy

The companion SHALL use the fixed provider-neutral policy `{ enabled: true,
requireConfirmation: true, automaticSessionRetention: true }` when evaluating an
approved Hindsight provider. The policy SHALL not be workspace-configurable or
controlled by an extension settings checkbox. Missing or unsafe providers SHALL
make the policy a no-op for provider operations while ordinary Chat, Write,
recall, reflect, and AGENTS.md behavior remain available.

Previously stored workspace retention disable values SHALL be ignored without
being deleted or rewritten.

#### Scenario: First use with an approved provider

- **WHEN** a workspace has no usable retention provider settings and the exact
  approved Hindsight provider passes verification
- **THEN** automatic session retention SHALL be enabled
- **AND** explicit retention SHALL be available
- **AND** every explicit retention request SHALL require confirmation

#### Scenario: Legacy disable values are present

- **WHEN** a workspace contains a previously stored retention disable value
- **THEN** the companion SHALL ignore that value
- **AND** it SHALL use the fixed always-on policy after provider verification
- **AND** it SHALL not write or delete the stored configuration value

#### Scenario: First use has safe defaults

- **WHEN** a workspace has no retention policy configured
- **THEN** the fixed provider-gated policy SHALL keep confirmation required and
  enable automatic retention when the approved provider passes verification
- **AND** explicit retention SHALL remain unavailable when no safe provider is
  present
- **AND** normal Chat, Write, recall, reflect, and AGENTS.md behavior SHALL
  remain available

#### Scenario: Invalid or managed settings are encountered

- **WHEN** a legacy retention setting is malformed or controlled by organization
  policy
- **THEN** the extension SHALL ignore it without overwriting the managed value
- **AND** the effective policy SHALL still require confirmation and remain
  provider-gated
- **AND** the user SHALL receive only a bounded, provider-neutral status or
  explanation

#### Scenario: Provider is absent or unsafe

- **WHEN** no exact approved provider is available, its capability is missing,
  or its sandbox/lifecycle checks fail
- **THEN** no retention operation SHALL be exposed or attempted
- **AND** ordinary Chat, Write, recall, reflect, and AGENTS.md behavior SHALL
  remain available

### Requirement: Gate explicit retention by policy and observed provider capability

The companion SHALL expose the exact `hindsight_ingest_document` operation by
default only when the approved provider is available or partially available with
`retain: true` and the exact operation is present in the observed tool
inventory. The companion SHALL never expose a retention wildcard. Provider
deletion, administration, diagnostics, synchronization, unknown tools, and
unobserved retention tools SHALL remain denied.

#### Scenario: Capable provider exposes exact retention

- **WHEN** the approved provider reports `retain: true`
- **AND** the exact retention tool is observed
- **THEN** Scout and Build SHALL receive only that exact operation with
  confirmation
- **AND** the research worker SHALL not receive the operation
- **AND** existing shell, edit, task, package, terminal, deletion,
  administration, and unknown-tool denials SHALL remain

#### Scenario: Explicit retention is enabled for a capable Hindsight provider

- **WHEN** the approved Hindsight provider reports retain capability and the
  exact Hindsight retention tool is observed
- **THEN** Chat and Write SHALL receive only that exact confirmation-gated
  retention operation by default
- **AND** the operation SHALL not be granted to the research worker
- **AND** shell, edit, task, package, terminal, deletion, administration, and
  unknown tools SHALL remain denied

#### Scenario: Retention prerequisites are not satisfied

- **WHEN** the provider is unavailable, blocked, errored, retain capability is
  false, or the exact retention tool is absent
- **THEN** no retention operation SHALL be exposed
- **AND** no provider write operation SHALL be attempted
- **AND** ordinary Chat and Write behavior SHALL continue with the existing
  read-only memory and AGENTS.md fallback where available

### Requirement: Require confirmation for every explicit retention

Every explicit retention operation SHALL require user confirmation at request
time. A confirmation response SHALL authorize at most the current bounded
request; an “always” response SHALL not permanently bypass confirmation.
Rejecting, timing out, or failing a request SHALL not report successful
retention.

#### Scenario: User confirms one retention request

- **WHEN** Scout or Write requests the exact retention operation
- **AND** the user confirms the request
- **THEN** only that bounded request SHALL be authorized
- **AND** the confirmation SHALL not authorize a later request
- **AND** provider credentials, paths, and raw output SHALL remain outside the
  UI boundary

#### Scenario: User rejects or a provider write fails

- **WHEN** the user rejects the retention request or the provider reports a
  failure
- **THEN** the provider SHALL not be reported as having retained the content
- **AND** no success state SHALL be emitted
- **AND** subsequent non-retention Chat/Write work SHALL remain usable

### Requirement: Validate and bound retention payloads

The companion SHALL continue to require a non-empty bounded summary, redact or
reject recognized credentials and secret material, and exclude raw tool payloads,
complete large documents, unrelated private content, untrusted retrieved/web
content, authorization material, and provider internals. Provider or policy
failures SHALL preserve ordinary Chat/Write startup and the active sandbox
without an unsandboxed retry.

#### Scenario: Safe bounded finding is retained

- **WHEN** the user approves a concise finding within the retention bound that
  contains no recognized secret material
- **THEN** the provider request SHALL contain only the bounded sanitized summary
  and safe metadata
- **AND** no raw transcript, tool payload, credential, or provider configuration
  SHALL be included

#### Scenario: Secret, empty, or oversized content is requested

- **WHEN** a proposed retention payload is empty, oversized, or contains
  recognized credential or secret material
- **THEN** the extension SHALL reject it or require a corrected summary
- **AND** the rejected content SHALL not be sent to the provider
- **AND** the user SHALL receive only a bounded provider-neutral explanation

### Requirement: Surface sanitized retention state

The extension SHALL not render retention enablement, automatic-retention, or
confirmation checkboxes in the Chat settings panel. It SHALL not expose a
webview policy-update message for retention and SHALL not contribute the legacy
workspace retention settings. Host-side enforcement and bounded provider
diagnostics MAY retain internal policy/status state, but provider-specific
details SHALL not cross into the removed settings surface.

#### Scenario: Settings panel has no retention controls

- **WHEN** the Chat settings panel is opened
- **THEN** it SHALL not render the former retention section or its checkboxes
- **AND** the MCP, sandbox, language, thinking, sound, and configuration-link
  controls SHALL remain available

#### Scenario: Retention state remains provider-neutral

- **WHEN** the host evaluates retention capability or failure
- **THEN** it MAY retain bounded internal state for enforcement and diagnostics
- **AND** it SHALL not expose provider paths, credentials, raw payloads, raw
  tool output, or unbounded error text through the webview

#### Scenario: Settings surface reports retention state

- **WHEN** the host evaluates retention for the settings/status boundary
- **THEN** it SHALL retain only provider-neutral state sufficient to explain
  that retention is provider-gated and confirmation-required
- **AND** the Chat settings panel SHALL not render the removed retention
  checkboxes or provider internals
- **AND** it SHALL not reveal provider paths, credentials, raw payloads, or raw
  tool output
