## MODIFIED Requirements

### Requirement: Keep companion Scout read-only

The companion-scoped Scout configuration SHALL deny editing and shell execution. Scout SHALL be allowed to use task delegation only for the exact extension-injected agent named `chat-research-worker`; all other task targets SHALL remain denied by a wildcard default. Scout SHALL retain read-only workspace discovery, documentation, web research, and clarification capabilities. When the retention policy is explicitly enabled and a verified provider exposes the exact confirmation-gated retention operation, Scout MAY request that durable-memory operation only through the user confirmation boundary; this exception SHALL not grant local file editing, shell execution, general writes, task recursion, package control, terminal control, provider administration, deletion, or unknown tools. The GUI SHALL retain `build` as the explicit agent for editing and command execution, and Build SHALL receive the same exact policy-gated retention operation without losing its wildcard denial.

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
- **AND** read, workspace discovery, web research, and clarification tools SHALL remain available
- **AND** the independent OpenCode TUI behavior SHALL remain unchanged

#### Scenario: Retention is an exact confirmation-gated exception

- **WHEN** the workspace retention policy is disabled or the provider retain capability/tool is unavailable
- **THEN** Scout SHALL not receive any retention operation
- **AND** Build SHALL not receive any retention operation
- **WHEN** the workspace retention policy is enabled and the exact provider retention operation is verified
- **THEN** Scout and Build SHALL receive only that exact operation through confirmation
- **AND** the research worker SHALL not receive the retention operation
- **AND** Scout and Build SHALL retain their existing shell, edit, task, package, terminal, deletion, administration, and unknown-tool denials
