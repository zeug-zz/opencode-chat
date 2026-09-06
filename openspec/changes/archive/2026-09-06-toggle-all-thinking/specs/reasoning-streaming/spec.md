## MODIFIED Requirements

### Requirement: Streaming reasoning text display
The system SHALL display reasoning/chain-of-thought text incrementally as it arrives from the opencode server, matching the streaming behavior of the opencode TUI. While reasoning is in progress, the reasoning block SHALL remain collapsed by default when the global show-all-thinking preference is disabled; when that preference is enabled, all current and future reasoning blocks SHALL show their bodies while text streams. Once reasoning completes, the block SHALL retain the same global or per-block visibility behavior while showing "Thought" with a toggle.

#### Scenario: Reasoning begins and text streams
- **WHEN** the server emits `session.next.reasoning.started` for an active message and the global show-all-thinking preference is disabled
- **THEN** a ReasoningPart is created in the message with no `time.end` field
- **AND** the reasoning block is collapsed by default, showing only the header with a spinner icon and "Thinking…" label

#### Scenario: Reasoning begins with the global preference enabled
- **WHEN** the server emits `session.next.reasoning.started` for an active message and the global show-all-thinking preference is enabled
- **THEN** a ReasoningPart is created in the message with no `time.end` field
- **AND** the reasoning block body is visible immediately with a spinner icon and "Thinking…" label

#### Scenario: Delta text accumulates during reasoning
- **WHEN** the server emits `session.next.reasoning.delta` with new text for the same `reasoningID`
- **THEN** the ReasoningPart's text field is updated with the accumulated text
- **AND** the UI re-renders to show the growing text in the expanded reasoning body when the global preference is enabled or the user has expanded that block

#### Scenario: User manually collapses during streaming
- **WHEN** a user clicks to collapse the reasoning block while streaming is active and the global show-all-thinking preference is disabled
- **THEN** the block collapses and stays collapsed even as new deltas arrive
- **AND** the user can re-expand it to see the latest accumulated text

#### Scenario: Global preference takes precedence while enabled
- **WHEN** the global show-all-thinking preference is enabled for a reasoning block
- **THEN** the reasoning body remains visible while new deltas arrive regardless of that block's local expansion state
- **AND** disabling the global preference restores the block's local expansion state without changing the accumulated reasoning text

#### Scenario: Reasoning completes
- **WHEN** the server emits `session.next.reasoning.ended` for the same `reasoningID`
- **THEN** the ReasoningPart's `time.end` is set to the current timestamp
- **AND** the label changes from "Thinking…" to "Thought"
- **AND** the spinner icon is replaced with an info icon
- **AND** the block is collapsed if the global preference is disabled and the user had not manually expanded it
- **AND** the block remains visible if the global preference is enabled

#### Scenario: No preceding reasoning events
- **WHEN** a `message.part.updated` event arrives with a completed `ReasoningPart` (with `time.end` set) without any prior `reasoning.*` events
- **THEN** the ReasoningPart is displayed as a completed "Thought" block using the global preference or its local expansion state (current fallback behavior preserved)

### Requirement: Reasoning event session filtering
The system SHALL filter `session.next.reasoning.*` events by the active session ID to prevent reasoning text from appearing in the wrong conversation.

#### Scenario: Event from inactive session is ignored
- **WHEN** the server emits `session.next.reasoning.delta` for a session that is not the currently active session
- **THEN** the delta is discarded and no ReasoningPart is created or updated

#### Scenario: Event from active session is processed
- **WHEN** the server emits `session.next.reasoning.delta` for the currently active session
- **THEN** the delta is accumulated into the correct ReasoningPart

### Requirement: Reasoning events added to AgentEvent type
The system SHALL include `session.next.reasoning.started`, `session.next.reasoning.delta`, and `session.next.reasoning.ended` in the `AgentEvent` discriminated union so TypeScript validates their handling at compile time.

#### Scenario: TypeScript compilation succeeds
- **WHEN** the AgentEvent union includes the three reasoning event types
- **THEN** `npm run build` and `npm test` pass without type errors
