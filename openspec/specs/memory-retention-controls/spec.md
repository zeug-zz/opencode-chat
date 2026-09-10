# memory-retention-controls Specification

## Purpose

This capability gives Chat and Write a provider-gated, confirmation-required path for retaining bounded project findings in an approved memory provider without weakening the no-provider fallback, sandbox, or agent permission boundaries. Automatic session retention uses the same fixed policy when its lifecycle checks pass.

## Requirements

### Requirement: Persist a safe workspace retention policy

The companion SHALL use the fixed provider-neutral policy `{ enabled: true, requireConfirmation: true, automaticSessionRetention: true }` after the exact approved Hindsight provider passes identity, capability, observed-tool, lifecycle, and sandbox checks. The policy SHALL not be workspace-configurable or controlled by an extension settings checkbox. Missing or unsafe providers SHALL make the policy a no-op for provider operations while ordinary Chat, Write, recall, reflect, and AGENTS.md behavior remain available. Previously stored workspace retention disable values SHALL be ignored without being deleted or rewritten.

#### Scenario: First use with an approved provider

- **WHEN** a workspace has no usable retention provider settings and the exact approved Hindsight provider passes verification
- **THEN** automatic session retention SHALL be enabled
- **AND** explicit retention SHALL be available
- **AND** every explicit retention request SHALL require confirmation
- **AND** normal Chat, Write, recall, reflect, and AGENTS.md behavior SHALL remain available

#### Scenario: Legacy disable values are present

- **WHEN** a workspace contains a previously stored retention disable value
- **THEN** the companion SHALL ignore that value
- **AND** it SHALL use the fixed always-on policy after provider verification
- **AND** it SHALL not write or delete the stored configuration value

#### Scenario: First use has safe defaults

- **WHEN** a workspace has no retention policy configured
- **THEN** the fixed provider-gated policy SHALL keep confirmation required and enable automatic retention when the approved provider passes verification
- **AND** explicit retention SHALL remain unavailable when no safe provider is present
- **AND** normal Chat, Write, recall, reflect, and AGENTS.md behavior SHALL remain available

#### Scenario: Invalid or managed settings are encountered

- **WHEN** a retention setting is malformed or controlled by organization policy
- **THEN** the extension SHALL ignore it without overwriting the managed value
- **AND** the effective policy SHALL still require confirmation and remain provider-gated
- **AND** the user SHALL receive only a bounded, provider-neutral status or explanation

### Requirement: Gate explicit retention by policy and observed provider capability

The companion SHALL expose the exact `hindsight_ingest_document` operation by default only when the approved provider is available or partially available with `retain: true` and the exact operation is present in the observed tool inventory. The companion SHALL never expose a retention wildcard. Provider deletion, administration, diagnostics, synchronization, unknown tools, and unobserved retention tools SHALL remain denied.

#### Scenario: Explicit retention is enabled for a capable Hindsight provider

- **WHEN** the approved Hindsight provider reports retain capability
- **AND** the exact Hindsight retention tool is observed
- **THEN** Chat and Write SHALL receive only that exact retention operation
- **AND** the operation SHALL not be granted to the research worker
- **AND** shell, edit, task, package, terminal, deletion, administration, and unknown tools SHALL remain denied

#### Scenario: Retention prerequisites are not satisfied

- **WHEN** the provider is unavailable, blocked, errored, retain capability is false, or the exact retention tool is absent
- **THEN** no retention operation SHALL be exposed
- **AND** no provider write operation SHALL be attempted
- **AND** ordinary Chat and Write behavior SHALL continue with the existing read-only memory and AGENTS.md fallback where available

### Requirement: Require confirmation for every explicit retention

Every explicit retention operation SHALL require a user confirmation at request time. A confirmation response SHALL authorize at most the current bounded retention request; an “always” response SHALL not permanently bypass confirmation. Rejecting or timing out a request SHALL leave the provider unchanged and SHALL not be reported as successful retention.

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

Automatic session retention SHALL be active only for the exact approved provider after capability, lifecycle, and sandbox verification. If provider integration fails, the extension SHALL preserve normal Chat and Write startup, applicable AGENTS.md guidance, and the existing sandbox mode without unsandboxed fallback; without a safe provider the fixed policy SHALL be a no-op.

#### Scenario: Automatic retention is provider-gated

- **WHEN** the companion starts with an approved Hindsight provider that passes lifecycle and sandbox verification
- **THEN** automatic session retention SHALL be active
- **AND** only explicitly confirmed requests may use the explicit retention operation
- **AND** the independent TUI configuration SHALL remain unchanged

#### Scenario: No provider or sandbox-safe provider path exists

- **WHEN** no usable provider is available or the provider cannot pass the active sandbox policy
- **THEN** retention SHALL be reported unavailable or blocked with a sanitized reason
- **AND** the companion SHALL not disable or weaken the sandbox
- **AND** ordinary Chat, Write, and AGENTS.md context SHALL remain usable

### Requirement: Surface sanitized retention state

The extension SHALL retain provider-neutral host-side enforcement and bounded diagnostics without rendering retention enablement, automatic-retention, or confirmation controls in the Chat settings panel. It SHALL not expose a webview policy-update message for retention or contribute the legacy workspace retention settings. Provider paths, credentials, raw payloads, raw tool output, and unbounded error text SHALL remain outside the webview boundary.

#### Scenario: Settings surface reports retention state

- **WHEN** the Chat settings panel is opened
- **THEN** it SHALL not render the former retention section or its checkboxes
- **AND** the MCP, sandbox, language, thinking, sound, and configuration-link controls SHALL remain available
