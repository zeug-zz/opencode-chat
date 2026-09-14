## MODIFIED Requirements

### Requirement: Keep companion Scout read-only
The companion-scoped Scout configuration SHALL deny editing and shell execution. Scout SHALL be allowed to use task delegation only for the exact extension-injected `chat-research-worker`; all other task targets SHALL remain denied by a wildcard default. Build-backed Write SHALL retain its deny-by-default boundary. Hindsight permissions for Scout and Build SHALL be exact, capability-gated, backend-scoped, and never grant arbitrary plugin authority.

When the verified nono backend is active, Scout and Build MAY receive only the exact approved observed Hindsight surface and native confirmation semantics. When the compatibility-sandbox fallback is active, they MAY receive only the exact recall/search operations. In that fallback, reflection, explicit retention, capture, diagnostics, synchronization, deletion, administration, unknown tools, and automatic lifecycle operations SHALL remain denied. The research worker SHALL remain Hindsight-free in every backend.

#### Scenario: Nono-backed Hindsight preserves agent boundaries
- **WHEN** the approved provider runs through the verified nono backend
- **THEN** Scout and Build SHALL receive only exact approved observed Hindsight permissions
- **AND** Scout SHALL retain its edit, shell, package, terminal, and arbitrary-task denials
- **AND** the research worker SHALL receive no Hindsight permission

#### Scenario: Fallback Hindsight is recall-only
- **WHEN** nono is unavailable before launch and recall capability is detected
- **THEN** Scout and Build SHALL receive only the three exact recall/search permissions
- **AND** reflection, writes, capture, diagnostics, synchronization, lifecycle, deletion, administration, and unknown Hindsight tools SHALL remain denied
- **AND** the research worker SHALL receive no Hindsight permission

#### Scenario: Hindsight does not escalate Write
- **WHEN** either backend enables an approved Hindsight operation for Build-backed Write
- **THEN** Write SHALL retain its wildcard denial for shell, task, package, terminal, and unknown tools
- **AND** no unrelated plugin tool or coding execution authority SHALL be added

#### Scenario: Inherited plugin loading does not broaden Scout
- **WHEN** the companion loads inherited native plugins in either backend
- **THEN** Scout SHALL retain edit, bash, and restricted-task permissions
- **AND** Build-backed Write SHALL retain its deny-by-default boundary

#### Scenario: Default chat agent
- **WHEN** the companion receives its server agent list after startup
- **THEN** it SHALL select eligible Scout as the default primary agent
- **AND** it SHALL retain Build as the alternate selectable agent
- **AND** it SHALL not promote the research worker to a primary agent

#### Scenario: Scout delegates only to the injected worker
- **WHEN** Scout requests task delegation to the exact injected `chat-research-worker`
- **THEN** the request SHALL be permitted within the existing worker boundary
- **AND** the worker SHALL run in subagent mode

#### Scenario: Scout cannot target arbitrary task agents
- **WHEN** Scout requests delegation to an arbitrary, user-defined, or similarly named agent
- **THEN** the request SHALL be denied
- **AND** Scout SHALL not receive general task or coding delegation capability

#### Scenario: Scout retains its direct tool boundary
- **WHEN** Scout operates through either selected backend
- **THEN** edit and shell execution SHALL remain denied
- **AND** only the backend-permitted exact Hindsight operations SHALL be available
- **AND** the independent TUI SHALL remain unchanged

#### Scenario: Retention is an exact confirmation-gated exception
- **WHEN** the verified nono backend and exact provider identity, observed operation, capability, and confirmation checks pass
- **THEN** Scout and Build SHALL receive only the exact approved native retention operation through confirmation
- **AND** the research worker SHALL not receive that operation
- **WHEN** the compatibility fallback is active or any required check fails
- **THEN** no retention operation SHALL be granted

#### Scenario: Build-backed Write receives no escalation from Hindsight
- **WHEN** the approved provider is enabled in either backend
- **THEN** Build-backed Write SHALL receive only its backend-permitted exact Hindsight operations
- **AND** it SHALL not receive deletion, administration, unknown tools, shell, task, package, or terminal authority
