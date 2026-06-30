## MODIFIED Requirements

### Requirement: Prefer plan for initial primary-agent selection
When the VS Code webview receives the opencode agent list and no primary agent has already been selected in the current webview session, OpenCode Chat SHALL initialize the selected primary agent to an eligible agent named `plan` when one exists. The `compact` menu action SHALL NOT participate in primary-agent initialization.

#### Scenario: Plan agent is available after build
- **WHEN** the webview receives agents where `build` appears before `plan`
- **AND** both agents have mode `primary` or `all`
- **AND** no primary agent is currently selected
- **THEN** the selected primary agent SHALL be `plan`
- **AND** the primary-agent selector SHALL display `chat`

#### Scenario: Plan agent is unavailable
- **WHEN** the webview receives agents with one or more agents whose mode is `primary` or `all`
- **AND** no eligible agent named `plan` is present
- **AND** no primary agent is currently selected
- **THEN** the selected primary agent SHALL be the first received agent whose mode is `primary` or `all`

#### Scenario: Compaction agent does not affect initialization
- **WHEN** the webview receives an eligible `compaction` agent
- **AND** the webview receives an eligible `plan` agent
- **AND** no primary agent is currently selected
- **THEN** the selected primary agent SHALL be `plan`
- **AND** the selector SHALL display `chat`
- **AND** the selector SHALL NOT display `compact` as the current primary-agent label

### Requirement: Preserve explicit primary-agent selection
OpenCode Chat SHALL NOT overwrite a non-empty selected primary agent when a subsequent agent-list message is received or when the user triggers one-shot menu actions such as `compact`.

#### Scenario: User selection survives agent refresh
- **WHEN** a primary agent is already selected in the current webview session
- **AND** the webview receives another agents message that includes an eligible `plan` agent
- **THEN** the existing selected primary agent SHALL remain selected
- **AND** initialization fallback logic SHALL NOT replace it

#### Scenario: User selection survives compact action
- **WHEN** a primary agent is already selected in the current webview session
- **AND** the user triggers the `compact` menu action
- **THEN** the existing selected primary agent SHALL remain selected
- **AND** the selector label SHALL continue to reflect the existing selected primary agent

### Requirement: Keep primary-agent send behavior unchanged
The default primary-agent selection behavior SHALL preserve existing message send behavior for selectable primary agents. One-shot menu actions such as `compact` SHALL NOT be sent as `primaryAgent` values in chat messages.

#### Scenario: Sending after default plan initialization
- **WHEN** the selected primary agent was initialized to `plan`
- **AND** the user sends a chat prompt
- **THEN** the webview SHALL include `primaryAgent: "plan"` in the existing send message payload
- **AND** no new protocol field SHALL be required

#### Scenario: Sending after compact action
- **WHEN** the selected primary agent is `plan`
- **AND** the user triggers the `compact` menu action
- **AND** the user then sends a chat prompt
- **THEN** the webview SHALL include `primaryAgent: "plan"` in the send message payload
- **AND** the webview SHALL NOT include `primaryAgent: "compaction"`
