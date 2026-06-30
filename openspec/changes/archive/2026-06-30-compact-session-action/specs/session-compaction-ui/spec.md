## ADDED Requirements

### Requirement: Trigger active session compaction from the Agents menu
The VS Code chat GUI SHALL provide a `compact` action in the Agents selector menu that invokes real session compaction for the active session.

#### Scenario: Compact action is shown after primary agents
- **WHEN** the webview has an active session and renders the Agents selector
- **THEN** the Agents selector menu SHALL show selectable primary agents first
- **AND** the menu SHALL show `compact` after `chat` and `build`

#### Scenario: Compact action invokes compression protocol
- **WHEN** the user clicks `compact` in the Agents selector menu
- **THEN** the webview SHALL post a `compressSession` message for the active session
- **AND** the message SHALL include the currently selected model when one is available

### Requirement: Preserve primary-agent selection when compacting
Compacting from the Agents menu SHALL NOT change the selected primary chat agent.

#### Scenario: Compact does not become the selected primary agent
- **WHEN** the selected primary agent is `plan`
- **AND** the user clicks `compact`
- **THEN** the selector SHALL continue to display `chat`
- **AND** subsequent chat sends SHALL continue to use `primaryAgent: "plan"`

#### Scenario: Build selection survives compact action
- **WHEN** the selected primary agent is `build`
- **AND** the user clicks `compact`
- **THEN** the selector SHALL continue to display `build`
- **AND** subsequent chat sends SHALL continue to use `primaryAgent: "build"`

### Requirement: Do not use compaction as chat primary agent
The GUI compact action SHALL NOT send normal chat prompts with `primaryAgent: "compaction"`.

#### Scenario: Compact sends no chat prompt
- **WHEN** the user clicks `compact`
- **THEN** the webview SHALL NOT post a `sendMessage` request caused by that click
- **AND** the webview SHALL NOT call primary-agent selection with `compaction`
