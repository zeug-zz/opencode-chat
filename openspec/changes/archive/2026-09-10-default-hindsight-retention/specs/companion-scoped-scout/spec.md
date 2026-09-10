## MODIFIED Requirements

### Requirement: Keep companion Scout read-only

The companion-scoped Scout configuration SHALL deny editing and shell execution.
Scout SHALL be allowed to use task delegation only for the exact
extension-injected agent named `chat-research-worker`; all other task targets
SHALL remain denied by a wildcard default. Scout SHALL retain read-only
workspace discovery, documentation, web research, clarification, and only the
exact capability-gated Hindsight recall/search, reflection, and confirmation-
gated retention tools. The retention exception SHALL not depend on a workspace
retention enablement setting, but SHALL require exact provider identity,
capability, observed-tool, lifecycle, sandbox, payload, and confirmation checks.
Loading user-installed plugins SHALL NOT broaden Scout's edit, shell, task,
package, terminal, deletion, administration, or unknown-tool permissions. The
GUI SHALL retain `build` as the explicit agent for editing and command
execution. Build-backed Write SHALL retain its deny-by-default boundary and
receive no plugin-driven escalation.

#### Scenario: Inherited plugin loading does not broaden Scout

- **WHEN** the companion loads one or more inherited native plugins
- **THEN** Scout SHALL retain its existing edit, bash, and restricted task permissions
- **AND** plugin loading SHALL not grant Scout arbitrary plugin tools or coding execution
- **AND** Build-backed Write SHALL retain its existing deny-by-default boundary

#### Scenario: Default chat agent

- **WHEN** the companion receives its server agent list after startup
- **THEN** it SHALL select eligible Scout as the default primary agent
- **AND** it SHALL retain `build` as the alternate selectable agent
- **AND** it SHALL not promote `chat-research-worker` to a primary agent

#### Scenario: Scout delegates only to the injected worker

- **WHEN** Scout requests task delegation
- **AND** the requested target is the exact injected agent
  `chat-research-worker`
- **THEN** the task request SHALL be permitted
- **AND** the worker SHALL run in `subagent` mode

#### Scenario: Scout cannot target arbitrary task agents

- **WHEN** Scout requests delegation to an arbitrary, user-defined, or merely
  similarly named agent
- **THEN** the task request SHALL be denied
- **AND** a user-defined `chat-research-*` name SHALL not gain access solely
  from its name
- **AND** Scout SHALL not receive a general task or coding delegation capability

#### Scenario: Scout retains its direct tool boundary

- **WHEN** Scout operates in the companion server
- **THEN** edit and shell execution SHALL remain denied
- **AND** only read, workspace discovery, web research, clarification, and exact
  verified Hindsight tools SHALL be available
- **AND** Hindsight administration, deletion, diagnostics, synchronization,
  wildcard, and unknown tools SHALL remain denied
- **AND** independent TUI behavior SHALL remain unchanged

#### Scenario: Retention is an exact confirmation-gated exception

- **WHEN** the exact approved provider, retain capability, observed retention
  tool, lifecycle, sandbox, payload, and confirmation checks pass
- **THEN** Scout and Build SHALL receive only the exact retention operation
- **AND** an “always” permission response SHALL remain limited to one request
- **AND** the research worker SHALL not receive retention

#### Scenario: Build-backed Write receives no escalation from Hindsight

- **WHEN** the approved Hindsight provider is enabled for the companion
- **THEN** Build-backed Write MAY receive only exact detected Hindsight
  recall/search, reflection, and confirmation-gated retention tools
- **AND** Write SHALL retain its deny-by-default boundary for shell, task,
  package, terminal, and unknown tools
- **AND** Write SHALL not receive Hindsight deletion, administration,
  diagnostics, synchronization, or unknown tools
