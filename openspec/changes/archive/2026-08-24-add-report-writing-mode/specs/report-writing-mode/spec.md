## Purpose

Provides a research-oriented Write mode that can gather evidence, draft reports, and save requested report files without exposing the chat companion to unrestricted coding or shell execution.

## ADDED Requirements

### Requirement: Constrain Write agent capabilities

When the user selects the `write` mode, the companion SHALL expose only read, workspace search, web research, and file-edit capabilities needed to produce a report. The companion SHALL NOT expose agent-level Bash execution or task/subagent delegation in Write mode.

#### Scenario: Write mode exposes report-authoring tools

- **WHEN** the selected user-facing mode is `write`
- **THEN** the companion SHALL allow reading files, searching the workspace, using configured web research tools, and editing report files
- **AND** Bash and task/subagent tools SHALL be unavailable to the Write agent

#### Scenario: Scout remains read-only

- **WHEN** the selected user-facing mode is `chat`
- **THEN** the companion SHALL retain Scout's existing read-only permissions and research tools
- **AND** selecting Write SHALL NOT broaden Scout's permissions

### Requirement: Apply report-authoring instructions to Write

When Write handles a message without an explicit system override, the companion SHALL apply dedicated report-authoring instructions that prioritize research quality, source attribution, clear separation of evidence and inference, and controlled file output. Write SHALL NOT receive Scout's read-only chat prompt as its mode prompt.

#### Scenario: Write drafts a sourced report

- **WHEN** the user asks Write to research a topic and save a report
- **THEN** Write SHALL gather relevant evidence before drafting where appropriate
- **AND** the resulting report SHALL identify or cite sources when sources are available
- **AND** Write SHALL save or update the requested report file without modifying unrelated files

#### Scenario: Write does not receive the Scout prompt

- **WHEN** the selected mode is `write`
- **AND** no explicit system override is supplied
- **THEN** the companion SHALL apply the Write report-authoring instructions
- **AND** it SHALL NOT apply the Scout prompt that describes the agent as read-only and unable to write files

### Requirement: Disable companion shell mode

The chat companion SHALL NOT provide a shell-mode input path. User-entered shell commands, including shell-mode prefixes, SHALL NOT be dispatched as companion shell execution requests.

#### Scenario: Shell mode is unavailable in the chat UI

- **WHEN** the user uses the chat companion in either `chat` or `write` mode
- **THEN** the shell-mode control SHALL not be available
- **AND** entering a shell-mode prefix SHALL be handled as ordinary text or rejected without executing a shell command

#### Scenario: Direct shell request is rejected

- **WHEN** the companion receives a direct request to execute a shell command through its webview protocol
- **THEN** the host SHALL reject the request without executing the command
- **AND** the user-facing chat session SHALL remain available

### Requirement: Preserve terminal handoff as the coding escape hatch

The chat companion SHALL keep the existing terminal handoff available independently of the selected chat or Write mode. Handoff SHALL open the active session in an independent OpenCode TUI process without enabling shell execution inside the companion.

#### Scenario: Write user hands off serious coding

- **WHEN** the user is in `write` mode and chooses the terminal handoff
- **THEN** the companion SHALL use the existing session handoff flow
- **AND** the independent TUI SHALL remain the supported path for unrestricted coding and shell work
- **AND** the companion process SHALL remain running

### Requirement: Preserve Write mode across message flows

When Write is selected, normal sends and edit-and-resend actions SHALL continue to use the internal `build` agent identifier and Write prompt behavior unless the user supplies an explicit system override.

#### Scenario: Write mode sends a report request

- **WHEN** the user selects `write` and sends a message
- **THEN** the request SHALL use `primaryAgent: "build"`
- **AND** the request SHALL use the Write report-authoring instructions

#### Scenario: Editing a Write request preserves the mode

- **WHEN** the user edits and resends a message created in `write` mode
- **THEN** the resend SHALL continue using the internal `build` agent identifier
- **AND** the resend SHALL retain Write prompt behavior
