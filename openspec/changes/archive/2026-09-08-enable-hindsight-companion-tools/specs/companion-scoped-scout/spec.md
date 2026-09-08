## MODIFIED Requirements

### Requirement: Keep companion Scout read-only

The companion-scoped Scout configuration SHALL deny editing and shell execution. Scout SHALL be allowed to use task delegation only for the exact extension-injected agent named `chat-research-worker`; all other task targets SHALL remain denied by a wildcard default. Scout SHALL retain read-only workspace discovery, documentation, web research, clarification, and only the exact capability-gated Hindsight recall/search and reflection tools when the approved provider is enabled. The Build-backed Write agent MAY receive the same exact Hindsight recall/search and reflection allows, but SHALL retain its deny-by-default boundary and SHALL not receive retention/write, deletion, provider-administration, shell, task, package, or terminal capabilities through this change. The GUI SHALL retain `build` as the explicit agent for editing and command execution.

#### Scenario: Default chat agent

- **WHEN** the companion receives its server agent list after startup
- **THEN** it SHALL select eligible Scout as the default primary agent
- **AND** it SHALL retain `build` as the alternate selectable agent
- **AND** it SHALL not promote `chat-research-worker` to a primary agent

#### Scenario: Scout delegates only to the injected worker

- **WHEN** Scout requests task delegation in the companion server
- **AND** the requested target is the exact injected agent `chat-research-worker`
- **THEN** the task request SHALL be permitted
- **AND** the worker SHALL run in `subagent` mode

#### Scenario: Scout cannot target arbitrary task agents

- **WHEN** Scout requests task delegation to an arbitrary, user-defined, or merely similarly named agent
- **THEN** the task request SHALL be denied
- **AND** a user-defined agent named with the `chat-research-*` pattern SHALL not gain access solely from that name
- **AND** Scout SHALL not receive a general task or coding delegation capability

#### Scenario: Scout retains its direct tool boundary

- **WHEN** Scout operates in the companion server
- **THEN** edit and shell execution SHALL remain denied
- **AND** read, workspace discovery, web research, clarification, and only the exact detected Hindsight recall/search and reflection tools SHALL be available
- **AND** Hindsight write/retention, deletion, administration, diagnostic, synchronization, and unknown tools SHALL remain denied
- **AND** the independent OpenCode TUI behavior SHALL remain unchanged

#### Scenario: Build-backed Write receives no escalation from Hindsight

- **WHEN** the approved Hindsight provider is enabled for the companion
- **THEN** Build-backed Write MAY receive only the exact detected Hindsight recall/search and reflection tools
- **AND** Write SHALL retain its wildcard denial for shell, task, package, terminal, and unknown tools
- **AND** Write SHALL not receive Hindsight write/retention, deletion, administration, diagnostic, synchronization, or unknown tools
