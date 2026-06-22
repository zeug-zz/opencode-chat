## ADDED Requirements

### Requirement: Prefer plan for initial primary-agent selection

When the VS Code webview receives the opencode agent list and no primary agent has already been selected in the current webview session, OpenCode Chat SHALL initialize the selected primary agent to an eligible agent named `plan` when one exists.

#### Scenario: Plan agent is available after build

- **WHEN** the webview receives agents where `build` appears before `plan`
- **AND** both agents have mode `primary` or `all`
- **AND** no primary agent is currently selected
- **THEN** the selected primary agent SHALL be `plan`
- **AND** the primary-agent selector SHALL display `plan`

#### Scenario: Plan agent is unavailable

- **WHEN** the webview receives agents with one or more agents whose mode is `primary` or `all`
- **AND** no eligible agent named `plan` is present
- **AND** no primary agent is currently selected
- **THEN** the selected primary agent SHALL be the first received agent whose mode is `primary` or `all`

### Requirement: Preserve explicit primary-agent selection

OpenCode Chat SHALL NOT overwrite a non-empty selected primary agent when a subsequent agent-list message is received.

#### Scenario: User selection survives agent refresh

- **WHEN** a primary agent is already selected in the current webview session
- **AND** the webview receives another agents message that includes an eligible `plan` agent
- **THEN** the existing selected primary agent SHALL remain selected
- **AND** initialization fallback logic SHALL NOT replace it

### Requirement: Keep primary-agent send behavior unchanged

The default primary-agent selection change SHALL preserve existing message send behavior for primary agents.

#### Scenario: Sending after default plan initialization

- **WHEN** the selected primary agent was initialized to `plan`
- **AND** the user sends a chat prompt
- **THEN** the webview SHALL include `primaryAgent: "plan"` in the existing send message payload
- **AND** no new protocol field SHALL be required
