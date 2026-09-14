# automatic-session-retention Specification

## Purpose

This capability enables approved provider lifecycle retention for companion Chat and Write sessions by default, while keeping it bounded, sandbox-aware, provider-neutral, and unavailable for provider operations when no safe provider is present.

## Requirements

### Requirement: Automatic retention is enabled by default for an approved provider
The companion SHALL resolve automatic session retention as enabled only when an exact approved provider is running through a successfully verified nono backend and passes its capability and lifecycle checks. There SHALL be no extension workspace setting or settings-panel checkbox that disables the effective policy. In the VS Code compatibility-sandbox fallback, automatic retention SHALL be unavailable and SHALL perform no provider lifecycle operation, while ordinary Chat, Write, AGENTS.md, and workspace-context behavior remain usable.

#### Scenario: First use with a nono-backed approved provider
- **WHEN** the companion has no automatic-retention setting
- **AND** an exact approved provider runs through the verified nono backend and passes lifecycle checks
- **THEN** automatic session retention SHALL be active by default for supported companion sessions
- **AND** the independent TUI lifecycle configuration SHALL remain unchanged

#### Scenario: Fallback backend has an approved provider
- **WHEN** nono is unavailable before launch
- **AND** the companion uses the VS Code compatibility-sandbox fallback
- **THEN** automatic retention SHALL be unavailable and non-mutating
- **AND** the fallback SHALL not initialize provider lifecycle hooks
- **AND** Chat and Write SHALL remain usable with permitted recall and ordinary context

#### Scenario: First use with an approved usable provider
- **WHEN** a workspace has no automatic-retention setting
- **AND** an exact approved provider runs through the verified nono backend and passes lifecycle checks
- **THEN** automatic session retention SHALL be active by default for supported companion sessions
- **AND** explicit provider operations SHALL retain their native confirmation semantics

#### Scenario: First use without a provider
- **WHEN** a workspace has no automatic-retention setting and no approved usable provider is available
- **THEN** automatic retention SHALL perform no provider operation
- **AND** the companion SHALL remain usable with ordinary context and applicable AGENTS.md guidance

#### Scenario: User explicitly disables automatic retention
- **WHEN** a legacy workspace automatic-retention setting is explicitly false
- **THEN** the extension SHALL not change the independent TUI configuration
- **AND** the fallback SHALL remain non-mutating while a verified nono provider follows the effective provider policy

### Requirement: Lifecycle retention is gated by approved provider and sandbox capability
Automatic retention SHALL activate only after the provider passes exact identity, observed-inventory, lifecycle-support, and verified-nono-backend checks. A provider in the compatibility-sandbox fallback SHALL not receive automatic-retention startup, and the extension SHALL not simulate native lifecycle behavior, broaden fallback filesystem access, or retry by weakening the selected backend.

#### Scenario: Nono-backed lifecycle is activated
- **WHEN** the exact approved provider runs through the verified nono backend
- **AND** the provider’s native lifecycle support passes the verification contract
- **THEN** the companion SHALL allow the provider-native automatic retention path
- **AND** it SHALL not create a second extension-managed retention loop

#### Scenario: Nono lifecycle is unsafe or unavailable
- **WHEN** nono preflight, provider identity, capability, or lifecycle verification fails
- **THEN** automatic retention SHALL remain unavailable
- **AND** the extension SHALL preserve the selected backend and ordinary Chat/Write operation where possible
- **AND** it SHALL not report a session as retained

#### Scenario: Approved Hindsight lifecycle is activated
- **WHEN** the exact approved Hindsight integration runs through the verified nono backend
- **AND** its native lifecycle support passes provider verification
- **THEN** the companion SHALL activate the provider-native lifecycle retention path
- **AND** the independent TUI process and configuration SHALL remain unchanged

#### Scenario: Lifecycle retention is disabled or unsafe
- **WHEN** provider identity, capability, lifecycle verification, or nono preflight fails
- **THEN** the companion SHALL suppress provider lifecycle retention
- **AND** it SHALL not weaken the selected sandbox or claim successful retention

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
- **AND** neither path SHALL grant unrelated plugins Hindsight authority or change the independent TUI

### Requirement: Automatic retention status is provider-neutral and independently surfaced

The host SHALL retain provider-neutral automatic-retention state for enforcement and bounded diagnostics independently from explicit retention and recall/reflect status. The removed settings surface SHALL not expose automatic enablement controls or provider internals. Status SHALL not include provider credentials, paths, raw payloads, lifecycle hook output, or unbounded errors.

#### Scenario: Status reports active automatic retention

- **WHEN** an approved provider passes lifecycle and sandbox checks and the effective automatic policy is enabled
- **THEN** the host SHALL retain an active provider-neutral automatic-retention state
- **AND** it SHALL continue to report explicit retention confirmation and recall/reflect capabilities separately
- **AND** the removed settings surface SHALL not expose provider internals

### Requirement: Automatic retention applies only to the native backend
The extension SHALL not require lifecycle parity between the nono backend and the compatibility-sandbox fallback. The fallback SHALL suppress lifecycle retention, while the nono backend SHALL preserve process-scoped native provider configuration without changing the independent TUI.

#### Scenario: Backend-scoped retention behavior
- **WHEN** the same approved provider is launched once through nono and once through the compatibility-sandbox fallback
- **THEN** only the nono-backed launch MAY activate automatic retention
- **AND** the fallback SHALL not expose automatic retention as active
- **AND** neither launch SHALL modify the independent TUI
