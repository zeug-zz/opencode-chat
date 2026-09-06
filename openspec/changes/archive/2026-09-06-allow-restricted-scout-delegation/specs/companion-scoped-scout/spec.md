## MODIFIED Requirements

### Requirement: Keep companion Scout read-only

The companion-scoped Scout configuration SHALL deny editing and shell execution. Scout SHALL be allowed to use task delegation only for the exact extension-injected agent named `chat-research-worker`; all other task targets SHALL remain denied by a wildcard default. Scout SHALL retain read-only workspace discovery, documentation, web research, and clarification capabilities. The GUI SHALL retain `build` as the explicit agent for editing and command execution.

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

## ADDED Requirements

### Requirement: Inject a read-only research worker

The extension-owned companion overlay SHALL inject exactly one initial research worker named `chat-research-worker` with mode `subagent`. The worker SHALL use an explicit catch-all denial followed by allows only for read, workspace discovery, web research, and the reviewed MCP tool prefixes `firecrawl_*`, `context-mode_*`, and `paper-search_*`. The worker SHALL deny edit, bash, shell execution, task recursion, coding and package operations, terminal control, unknown tools, and unapproved MCP tools. The worker profile SHALL be delivered only through the companion's in-memory overlay and SHALL not alter user or workspace OpenCode configuration.

#### Scenario: Worker exposes only approved read and research capabilities

- **WHEN** the companion advertises `chat-research-worker`
- **THEN** the worker SHALL have mode `subagent`
- **AND** its effective permission rules SHALL deny `*` by default
- **AND** read, glob, grep, list, webfetch, and websearch SHALL be allowed
- **AND** tools matching `firecrawl_*`, `context-mode_*`, or `paper-search_*` SHALL be allowed
- **AND** edit, bash, task, todowrite, skill, terminal, and unknown tool patterns SHALL remain denied

#### Scenario: Research MCP access follows Chat preferences

- **WHEN** a reviewed Firecrawl, context-mode, or paper-search server is explicitly enabled through the existing Chat MCP preference
- **THEN** the worker MAY use the matching reviewed tool prefix
- **AND** the server SHALL remain governed by the existing companion MCP overlay and sandbox/network policy
- **AND** the worker SHALL not receive a generic MCP wildcard

#### Scenario: Disabled or unapproved MCP tools remain unavailable

- **WHEN** a reviewed research server is disabled or an unapproved MCP server is enabled in Chat
- **THEN** the worker SHALL not be able to use tools from that disabled or unapproved server
- **AND** enabling a server SHALL not grant the worker edit, shell, task, package, or terminal capabilities
- **AND** MCP output SHALL remain downstream untrusted evidence rather than an instruction source

#### Scenario: Overlay parity preserves the boundary

- **WHEN** the extension starts the companion through either its unsandboxed or sandboxed launch path
- **THEN** both paths SHALL expose the same Scout target restriction and worker permission boundary
- **AND** the independent OpenCode TUI SHALL receive neither the injected worker nor the Scout task allowlist
- **AND** no OpenCode configuration file SHALL be written as a side effect
