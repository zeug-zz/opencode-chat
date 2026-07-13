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
The companion-scoped Scout configuration SHALL deny editing, shell execution, and task delegation while allowing read-only workspace discovery and documentation/research tools. The GUI SHALL retain `build` as the explicit agent for editing and command execution.

#### Scenario: Default chat agent
- **WHEN** the companion receives its server agent list after startup
- **THEN** it SHALL select eligible Scout as the default primary agent
- **AND** it SHALL retain `build` as the alternate selectable agent

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
