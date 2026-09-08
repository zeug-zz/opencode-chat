## Purpose

This capability gives Chat and Write a user-controlled, confirmation-gated path for retaining bounded project findings in an approved memory provider without weakening the no-provider fallback, sandbox, or agent permission boundaries.

## ADDED Requirements

### Requirement: Persist a safe workspace retention policy

The extension SHALL expose a workspace-scoped memory retention policy with explicit retention disabled by default, confirmation required by default, and automatic session retention disabled by default. Invalid, missing, or organization-managed values SHALL resolve to the safest effective policy. The policy SHALL be independent from the existing read/reflect capability status and SHALL not require a memory provider for ordinary Chat or Write operation.

#### Scenario: First use has safe defaults

- **WHEN** a workspace has no retention policy configured
- **THEN** explicit retention SHALL be unavailable until the user enables it
- **AND** every explicit retention request SHALL require confirmation
- **AND** automatic session retention SHALL remain disabled
- **AND** normal Chat, Write, recall, reflect, and AGENTS.md behavior SHALL remain available

#### Scenario: Invalid or managed settings are encountered

- **WHEN** a retention setting is malformed or controlled by organization policy
- **THEN** the effective policy SHALL fail closed for durable writes
- **AND** the extension SHALL not overwrite the managed value
- **AND** the user SHALL receive only a bounded, provider-neutral status or explanation

### Requirement: Gate explicit retention by policy and observed provider capability

The companion SHALL expose an exact provider retention operation only when explicit retention is enabled, the selected provider is approved and available or partially available with `retain: true`, and the exact retention tool is present in the observed provider inventory. The companion SHALL never expose a retention wildcard. Provider deletion, administration, diagnostics, synchronization, unknown tools, and retention tools absent from the verified inventory SHALL remain denied.

#### Scenario: Explicit retention is enabled for a capable Hindsight provider

- **WHEN** the user enables explicit retention for the workspace
- **AND** the approved Hindsight provider reports retain capability
- **AND** the exact Hindsight retention tool is observed
- **THEN** Chat and Write SHALL receive only that exact retention operation
- **AND** the operation SHALL not be granted to the research worker
- **AND** shell, edit, task, package, terminal, deletion, administration, and unknown tools SHALL remain denied

#### Scenario: Retention prerequisites are not satisfied

- **WHEN** explicit retention is disabled, the provider is unavailable/blocked/error, retain capability is false, or the exact retention tool is absent
- **THEN** no retention operation SHALL be exposed
- **AND** no provider write operation SHALL be attempted
- **AND** ordinary Chat and Write behavior SHALL continue with the existing read-only memory and AGENTS.md fallback where available

### Requirement: Require confirmation for every explicit retention

Every explicit retention operation SHALL require a user confirmation at the time of the request when confirmation is enabled. A confirmation response SHALL authorize at most the current bounded retention request; choosing an "always" or equivalent permission response SHALL not permanently bypass confirmation while the policy requires confirmation. Rejecting or timing out a request SHALL leave the provider unchanged and SHALL not be reported as successful retention.

#### Scenario: User confirms one retention request

- **WHEN** Chat or Write requests the exact retention operation
- **AND** the user confirms the request
- **THEN** only that request SHALL be authorized
- **AND** the confirmation SHALL be associated with the current session/request
- **AND** the UI/status path SHALL not expose provider credentials, paths, or raw provider output

#### Scenario: User rejects or a provider write fails

- **WHEN** the user rejects the retention request or the provider reports a failure
- **THEN** the provider SHALL not be reported as having retained the content
- **AND** no success status SHALL be emitted
- **AND** Chat and Write SHALL remain usable for subsequent non-retention work

### Requirement: Validate and bound retention payloads

Before an explicit retention request crosses the provider boundary, the extension SHALL require a non-empty bounded summary, redact recognized credentials and secret material, and reject or require correction for content that exceeds the configured bound. Retention SHALL exclude raw tool payloads, complete large documents, unrelated private workspace content, and untrusted retrieved/web content by default. The policy SHALL preserve user-provided meaning without retaining hidden diagnostics, authorization material, or provider internals.

#### Scenario: Safe bounded finding is retained

- **WHEN** the user approves a concise finding that fits the retention bound and contains no recognized secret material
- **THEN** the provider request SHALL contain only the bounded sanitized summary and its safe metadata
- **AND** no raw transcript, tool payload, credential, or provider configuration SHALL be included

#### Scenario: Secret, empty, or oversized content is requested

- **WHEN** a proposed retention payload is empty, exceeds the bound, or contains recognized credential/secret material
- **THEN** the extension SHALL reject it or require a corrected summary before provider invocation
- **AND** the rejected content SHALL not be sent to the provider
- **AND** the user SHALL receive a bounded provider-neutral explanation

### Requirement: Keep automatic retention disabled and preserve fallback behavior

This change SHALL not enable provider lifecycle hooks or automatic session/transcript retention. The companion SHALL continue to suppress automatic Hindsight lifecycle behavior, and enabling explicit retention SHALL not grant automatic retention. If retention policy loading or provider integration fails, the extension SHALL preserve normal Chat and Write startup, applicable AGENTS.md guidance, and the existing sandbox mode without unsandboxed fallback.

#### Scenario: Automatic retention remains disabled

- **WHEN** the companion starts with an approved Hindsight provider and explicit retention enabled
- **THEN** lifecycle hooks and automatic session retention SHALL remain disabled
- **AND** only an explicitly confirmed retention request may write durable memory
- **AND** the independent TUI configuration SHALL remain unchanged

#### Scenario: No provider or sandbox-safe provider path exists

- **WHEN** no usable provider is available or the provider cannot pass the active sandbox policy
- **THEN** retention SHALL be reported unavailable or blocked with a sanitized reason
- **AND** the companion SHALL not disable or weaken the sandbox
- **AND** ordinary Chat, Write, and AGENTS.md context SHALL remain usable

### Requirement: Surface sanitized retention state

The extension SHALL expose retention policy and availability through the existing typed host/UI boundary or equivalent settings surface using provider-neutral fields. The surfaced state SHALL distinguish disabled, awaiting confirmation, available, blocked, unavailable, and error conditions without exposing provider paths, credentials, raw payloads, raw tool output, or unbounded error text.

#### Scenario: Settings surface reports retention state

- **WHEN** the settings/status surface is rendered
- **THEN** it SHALL show whether explicit retention is enabled and whether confirmation is required
- **AND** it SHALL show a safe availability state derived from the provider status
- **AND** it SHALL explain that retrieved memory is evidence rather than instructions
- **AND** it SHALL not reveal provider internals
