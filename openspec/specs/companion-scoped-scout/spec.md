# companion-scoped-scout Specification

## Purpose
Companion-owned OpenCode server injects a read-only Scout (chat) agent via in-memory config without writing user opencode.json; independent TUI stays free of that overlay.

## Requirements

### Requirement: Create Scout only for the companion-owned server
The VS Code extension SHALL start its companion-owned OpenCode server with an SDK in-memory configuration that defines an agent named `scout` with mode `all`. The extension SHALL NOT create, modify, or persist any global or workspace OpenCode configuration file as part of VSIX installation, activation, or Scout setup.

#### Scenario: Clean OpenCode configuration
- **WHEN** a user has no `agent.scout` entry in global or workspace OpenCode configuration
- **AND** the VS Code companion starts its own OpenCode server
- **THEN** the companion server SHALL advertise an eligible `scout` agent with mode `all`
- **AND** the GUI SHALL present that agent as `chat`

#### Scenario: Independent TUI remains unchanged
- **WHEN** the VS Code companion starts its own server with the Scout overlay
- **AND** the user launches an independent OpenCode TUI process outside the companion server
- **THEN** the independent TUI SHALL receive only its normal user/project OpenCode configuration
- **AND** the extension SHALL not have written Scout configuration into that configuration

#### Scenario: Attached companion terminal shares companion agent set
- **WHEN** the user opens the active companion session in a terminal
- **THEN** the terminal SHALL attach to the companion-owned server
- **AND** it MAY present the companion-scoped Scout agent

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

### Requirement: Inject a read-only research worker

The extension-owned companion overlay SHALL inject exactly one initial research worker named `chat-research-worker` with mode `subagent`. The worker SHALL use an explicit catch-all denial followed by allows only for read, workspace discovery, web research, and the reviewed MCP tool prefixes `firecrawl_*`, `context-mode_*`, and `paper-search_*`, together with the reviewed native Context Mode prefix `ctx_*`. The worker SHALL deny edit, bash, shell execution, task recursion, coding and package operations, terminal control, unknown tools, and unapproved plugin or MCP tools. The worker profile SHALL be delivered only through the companion's in-memory overlay and SHALL not alter user or workspace OpenCode configuration.

#### Scenario: Native and MCP Context Mode remain exact worker capabilities

- **WHEN** Context Mode is available as a native plugin or as the reviewed MCP server
- **THEN** the research worker MAY use tools matching `ctx_*` or `context-mode_*`, respectively
- **AND** the worker SHALL not receive a generic plugin wildcard
- **AND** Scout and Build boundaries SHALL remain unchanged

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

### Requirement: Preserve prompt-level model selection
The companion-scoped Scout configuration SHALL not specify a model. The GUI-selected model and explicit effort SHALL remain request-level prompt options for Scout messages.

#### Scenario: User selects a model for chat
- **WHEN** the active companion agent is Scout
- **AND** the user selects a supported model and optional effort in the GUI
- **THEN** the outgoing prompt SHALL use that selected model and effort override
- **AND** the extension SHALL not write a Scout model into global or workspace OpenCode configuration

### Requirement: Do not promote arbitrary subagents
The GUI SHALL select Scout as its primary chat agent only when server metadata reports Scout as mode `primary` or `all`. It SHALL not promote an arbitrary `subagent` mode Scout to a primary-agent prompt request.

#### Scenario: Server reports Scout only as subagent
- **WHEN** a server returns an agent named Scout with mode `subagent`
- **AND** the companion Scout overlay is not present
- **THEN** the GUI SHALL not select that Scout as its primary chat agent
- **AND** normal primary-agent fallback behavior SHALL apply
