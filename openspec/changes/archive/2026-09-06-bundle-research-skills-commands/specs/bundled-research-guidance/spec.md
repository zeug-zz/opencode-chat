## Purpose

This capability makes the OpenCode Research research and report-writing guidance available from the packaged extension, so users and the companion agent can use reviewed skills and command templates on demand without workspace copies or unnecessary prompt context.

## ADDED Requirements

### Requirement: Reviewed guidance resources are bundled with the extension

The packaged VSIX SHALL contain the reviewed guidance resources from the repository `skills-commands/` source set. The initial bundle SHALL include the four skill documents `citation-audit/SKILL.md`, `evidence-synthesis/SKILL.md`, `mcp-research/SKILL.md`, and `research-workflow/SKILL.md`, together with the five command documents `research-answer.md`, `research-citations.md`, `research-edit.md`, `research-plan.md`, and `research-report.md`.

The runtime resource root SHALL be resolved from the installed extension and SHALL NOT be resolved from, copied into, or written beneath the active workspace. Build staging MAY create generated package files inside the repository, but those files SHALL be reproducible from the canonical source set.

#### Scenario: VSIX contains the reviewed guidance set

- **WHEN** the extension is built and packaged
- **THEN** the VSIX SHALL contain every initial skill and command document
- **AND** the packaged paths SHALL be under the extension-owned resource root
- **AND** the package SHALL not require any corresponding file in the active workspace

#### Scenario: Installed extension resolves its own resources

- **WHEN** Chat starts from an installed VSIX
- **THEN** the companion SHALL resolve bundled resources from the installed extension location
- **AND** changing the active workspace SHALL not change the bundled resource location
- **AND** the extension SHALL not create a workspace `.opencode/command` or skill copy for this capability

### Requirement: Companion discovery uses process-scoped in-memory configuration

The Chat companion SHALL expose the bundled skills through its effective OpenCode skill discovery path and SHALL register bundled command templates in its process-scoped configuration. The configuration SHALL apply only to the Chat companion process and SHALL preserve the user's global and project OpenCode configuration ownership. Bundled resource registration SHALL not alter an independently running OpenCode CLI or TUI process.

#### Scenario: Bundled skills are available to the companion agent

- **WHEN** the Chat companion starts successfully
- **THEN** the companion's effective skill discovery SHALL include the extension-owned bundled skill directory
- **AND** the companion agent SHALL be able to load an individual bundled skill by name
- **AND** the extension SHALL not write a global or project OpenCode configuration file

#### Scenario: Bundled commands are available without workspace command files

- **WHEN** the user invokes a bundled command by its documented name
- **THEN** the companion SHALL resolve the corresponding bundled command template
- **AND** command arguments SHALL be applied to that invocation only
- **AND** no `.opencode/command` file SHALL be created or required in the workspace

#### Scenario: Independent OpenCode processes are unaffected

- **WHEN** an independent OpenCode CLI or TUI process runs in the same workspace
- **THEN** it SHALL retain its normal skill, command, configuration, and MCP behavior
- **AND** the bundled Chat guidance overlay SHALL not be visible as a global or project configuration change

### Requirement: Guidance is loaded on demand

The extension SHALL NOT append the full bundled skill and command corpus to every Chat or Write system prompt or ordinary user message. Skill content SHALL be loaded when the user selects a skill or when the companion agent explicitly loads that skill. Command templates SHALL be applied only when the user invokes the corresponding command. Resource names and short descriptions MAY be sent to the UI as picker metadata without counting as prompt-body injection.

#### Scenario: Ordinary message has no bundled corpus injection

- **WHEN** the user sends an ordinary Chat or Write message without selecting a bundled skill or command
- **THEN** the request SHALL not include the full bundled skill or command bodies
- **AND** the existing Chat and Write prompt behavior SHALL remain unchanged

#### Scenario: Selected guidance is scoped to one invocation

- **WHEN** the user selects one bundled skill or invokes one bundled command
- **THEN** only the selected skill or invoked command guidance SHALL be made available for that request
- **AND** unrelated bundled guidance SHALL not be appended to the request
- **AND** the guidance SHALL not persist as an unbounded accumulation in later messages

#### Scenario: Missing optional guidance does not block ordinary Chat

- **WHEN** a bundled resource is unavailable or invalid
- **THEN** the affected picker entry or command SHALL be omitted or reported unavailable
- **AND** ordinary Chat and Write operation SHALL remain available
- **AND** the extension SHALL not respond by copying the resource into the workspace

### Requirement: Users can select bundled skills and commands from the slash picker

The existing slash picker SHALL present bundled skills and bundled commands alongside the corresponding native skill entries. Each entry SHALL expose its name and description and SHALL have a clear type distinction between a skill and a command. Filtering by slash-query text SHALL cover both types. Selecting a bundled skill SHALL preserve the existing skill invocation behavior; selecting a bundled command SHALL invoke its command template with the user's entered text as its arguments.

#### Scenario: Bundled skills appear in the picker

- **WHEN** the slash picker is opened after Chat initialization
- **THEN** the bundled skills SHALL be listed with their names and descriptions
- **AND** each bundled skill SHALL be distinguishable from a bundled command
- **AND** selecting a skill SHALL not add any file to the workspace

#### Scenario: Bundled commands appear in the picker

- **WHEN** the slash picker is opened after Chat initialization
- **THEN** the bundled commands SHALL be listed with their names and descriptions
- **AND** each bundled command SHALL be distinguishable from a skill
- **AND** selecting a command SHALL not require a workspace command file

#### Scenario: Slash filtering covers both guidance types

- **WHEN** the user enters a slash query matching a bundled skill or command name or description
- **THEN** the matching bundled entries SHALL remain selectable
- **AND** non-matching entries SHALL be filtered consistently with existing skill-picker behavior

#### Scenario: Command arguments reach the selected template

- **WHEN** the user selects a bundled command and submits text after the selection
- **THEN** the command invocation SHALL receive that text as its argument content
- **AND** the command SHALL not be sent as an ordinary unexpanded literal prompt
- **AND** the resulting request SHALL retain the currently selected Chat or Write agent boundary

### Requirement: Optional research tooling remains capability-oriented

The bundled skills and commands SHALL treat external research and memory/indexing tooling as optional runtime capabilities. They SHALL preserve the existing guidance to inspect the tools exposed in the current session, use an available capability when appropriate, state material limitations, and fall back when a recommended tool is absent. The bundled guidance SHALL not require installation, configuration, or a particular provider. Product-specific memory and indexing references SHALL use generic memory-update and indexing/retrieval language while preserving the surrounding research, provenance, safety, and persistence guidance.

The VSIX README Requirements section SHALL identify the following as optional, user-installed research integrations rather than extension dependencies: context-mode, Firecrawl, Brave Search, PDF readers, paper search, and Playwright.

#### Scenario: Recommended tools are absent

- **WHEN** the user invokes research guidance without one or more recommended external tools installed
- **THEN** the companion SHALL use the suitable capabilities actually exposed in that session
- **AND** it SHALL state material evidence or access limitations when a preferred capability is unavailable
- **AND** the extension SHALL not attempt to install, configure, or invent the missing tool

#### Scenario: Recommended tools are available

- **WHEN** one or more optional research tools are exposed by the current session
- **THEN** the relevant guidance SHALL route those capabilities through the applicable research skillset
- **AND** the guidance SHALL retain bounded evidence, provenance, untrusted-content, and fallback behavior
- **AND** ordinary prompts SHALL not receive the tool instructions unless the relevant skill or command is invoked

#### Scenario: Guidance has no product-specific memory or indexing dependency

- **WHEN** the bundled skill and command documents are inspected
- **THEN** persistence instructions SHALL refer to generic memory updates or durable memory systems
- **AND** indexing instructions SHALL refer to generic indexing or retrieval capabilities
- **AND** the documents SHALL not require a particular memory product or indexing installation

### Requirement: Guidance failures are bounded and visible

The extension SHALL validate the bundled resource set before exposing it to the companion or picker. A malformed frontmatter document, invalid command definition, or missing resource SHALL affect only that resource and SHALL produce a bounded diagnostic suitable for troubleshooting. Resource validation SHALL never broaden filesystem permissions, mutate user configuration, or silently replace the normal Chat or Write path with a workspace copy.

#### Scenario: One malformed command is isolated

- **WHEN** one bundled command document cannot be parsed
- **THEN** that command SHALL be unavailable
- **AND** valid bundled skills and commands SHALL remain available
- **AND** ordinary Chat and Write operation SHALL continue
- **AND** the diagnostic SHALL not include full resource contents or user secrets

#### Scenario: Resource validation succeeds

- **WHEN** all reviewed resources pass validation
- **THEN** the companion and picker SHALL expose only the validated names, descriptions, and bodies
- **AND** resource ordering SHALL be deterministic
- **AND** the extension SHALL not expose files outside the reviewed bundle
