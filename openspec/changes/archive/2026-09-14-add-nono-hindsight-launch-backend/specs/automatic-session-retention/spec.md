## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Automatic retention applies only to the native backend
The extension SHALL not require lifecycle parity between the nono backend and the compatibility-sandbox fallback. The fallback SHALL suppress lifecycle retention, while the nono backend SHALL preserve process-scoped native provider configuration without changing the independent TUI.

#### Scenario: Backend-scoped retention behavior
- **WHEN** the same approved provider is launched once through nono and once through the compatibility-sandbox fallback
- **THEN** only the nono-backed launch MAY activate automatic retention
- **AND** the fallback SHALL not expose automatic retention as active
- **AND** neither launch SHALL modify the independent TUI
