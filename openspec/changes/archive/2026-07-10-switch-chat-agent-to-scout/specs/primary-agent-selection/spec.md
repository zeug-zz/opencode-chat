## MODIFIED Requirements

### Requirement: Prefer plan for initial primary-agent selection

When the VS Code webview receives the opencode agent list and no primary agent has already been selected in the current webview session, OpenCode Chat SHALL initialize the selected primary agent to an eligible agent named `scout` when one exists.

#### Scenario: Scout agent is available after build

- **WHEN** the webview receives agents where `build` appears before `scout`
- **AND** `build` has mode `primary` or `all`
- **AND** `scout` has mode `primary` or `all`
- **AND** no primary agent is currently selected
- **THEN** the selected primary agent SHALL be `scout`
- **AND** the primary-agent selector SHALL display `chat`

#### Scenario: Scout agent is unavailable

- **WHEN** the webview receives agents with one or more agents whose mode is `primary` or `all`
- **AND** no eligible agent named `scout` is present
- **AND** no primary agent is currently selected
- **THEN** the selected primary agent SHALL be the first received agent whose mode is `primary` or `all`

### Requirement: Preserve explicit primary-agent selection

OpenCode Chat SHALL NOT overwrite a non-empty selected primary agent when a subsequent agent-list message is received.

#### Scenario: User selection survives agent refresh

- **WHEN** a primary agent is already selected in the current webview session
- **AND** the webview receives another agents message that includes an eligible `scout` agent
- **THEN** the existing selected primary agent SHALL remain selected
- **AND** initialization fallback logic SHALL NOT replace it

### Requirement: Keep primary-agent send behavior unchanged

The default primary-agent selection change SHALL preserve existing message send behavior for primary agents.

#### Scenario: Sending after default Scout initialization

- **WHEN** the selected primary agent was initialized to `scout`
- **AND** the user sends a chat prompt
- **THEN** the webview SHALL include `primaryAgent: "scout"` in the existing send message payload
- **AND** no new protocol field SHALL be required

## ADDED Requirements

### Requirement: Append chat companion prompt for Scout

OpenCode Chat SHALL append the chat companion system prompt when sending a message with selected primary agent `scout` and no explicit system override is provided.

#### Scenario: Scout chat message uses chat companion prompt

- **WHEN** the webview sends a chat message with `primaryAgent: "scout"`
- **AND** the message does not include an explicit `system` override
- **THEN** the extension host SHALL forward the loaded chat companion system prompt to the agent send call

#### Scenario: Build message does not use chat companion prompt

- **WHEN** the webview sends a chat message with `primaryAgent: "build"`
- **AND** the message does not include an explicit `system` override
- **THEN** the extension host SHALL NOT inject the chat companion system prompt
