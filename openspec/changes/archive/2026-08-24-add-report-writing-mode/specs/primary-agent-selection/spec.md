## MODIFIED Requirements

### Requirement: Append chat companion prompt for Scout

OpenCode Chat SHALL inject the chat companion system prompt only when sending a message with selected primary agent `scout` and no explicit system override. When the selected primary agent is the user-facing `write` mode backed by internal agent `build`, OpenCode Chat SHALL inject the dedicated Write report-authoring prompt instead and SHALL preserve the internal agent name for message requests.

#### Scenario: Scout chat message uses chat companion prompt

- **WHEN** the webview sends a chat message with `primaryAgent: "scout"`
- **AND** the message does not include an explicit `system` override
- **THEN** the extension host SHALL forward the loaded chat companion system prompt to the agent send call
- **AND** the extension host SHALL NOT forward the Write report-authoring prompt for that message

#### Scenario: Write message uses the report-authoring prompt

- **WHEN** the webview sends a chat message with `primaryAgent: "build"`
- **AND** the message does not include an explicit `system` override
- **THEN** the extension host SHALL forward the Write report-authoring prompt to the agent send call
- **AND** the extension host SHALL NOT inject the chat companion system prompt

#### Scenario: Write message does not use chat companion prompt

- **WHEN** the webview sends a chat message with `primaryAgent: "build"`
- **AND** the message does not include an explicit `system` override
- **THEN** the extension host SHALL NOT inject the chat companion system prompt

#### Scenario: Explicit system override remains authoritative

- **WHEN** the webview sends a message with an explicit `system` override
- **THEN** the extension host SHALL forward the explicit system override
- **AND** it SHALL NOT replace that override with the Scout or Write default prompt
