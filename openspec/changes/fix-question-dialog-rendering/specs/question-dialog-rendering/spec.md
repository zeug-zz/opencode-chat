## Purpose

This capability keeps interactive question requests visible and answerable as
soon as the active OpenCode turn asks them, including while the message stream
is still busy.

## ADDED Requirements

### Requirement: Question requests render without unrelated message updates

The webview SHALL treat the active question state associated with an assistant
message as render-affecting state. When a valid `question.asked` event is
received for the active session and its associated assistant message is
already rendered, the question UI SHALL appear in that message during the
same state update without requiring a new message event, an interrupt, or a
session-status transition.

#### Scenario: Question appears during an active turn

- **WHEN** an active assistant message is rendered and a matching
  `question.asked` event is received while the session remains busy
- **THEN** the question UI SHALL be visible without an additional message
  update or user interrupt
- **AND** the streaming indicator MAY remain visible until the normal session
  status changes

#### Scenario: Question state changes invalidate the affected message

- **WHEN** a pending question is answered or rejected
- **THEN** the associated question UI SHALL be removed after the corresponding
  state/event update
- **AND** unrelated message content SHALL not be changed

#### Scenario: Question remains scoped to the active session and message

- **WHEN** a question event belongs to another session or lacks a matching
  message association
- **THEN** it SHALL not be rendered in the active assistant message
- **AND** the webview SHALL preserve the existing session and message
  association rules

### Requirement: Newly rendered questions are visible without disrupting scrolling

When a question becomes visible, the message area SHALL treat the added
question content as a possible scrollable-content change. If the user is at or
near the bottom, the message area SHALL keep the newly rendered question in
view. If the user has intentionally scrolled away from the bottom, the message
area SHALL preserve their scroll position and SHALL not force them to the
question.

#### Scenario: Near-bottom user sees the question

- **WHEN** a matching question is added while the message area is at or near
  the bottom
- **THEN** the message area SHALL scroll as needed so the question UI is
  visible

#### Scenario: Scrolled-up user is not displaced

- **WHEN** a matching question is added while the user is more than the
  existing near-bottom threshold from the bottom
- **THEN** the message area SHALL preserve the user's scroll position
- **AND** the question SHALL remain available through the normal message
  content and scroll controls

### Requirement: Existing question interaction contracts remain unchanged

The rendering fix SHALL preserve the existing question protocol and interaction
behavior. Selecting options, entering custom text, submitting an answer, and
rejecting a request SHALL continue to send the same typed bridge messages and
request identifiers as before.

#### Scenario: Answer and reject actions retain their request identity

- **WHEN** the user submits or rejects a question that was rendered after a
  `question.asked` event
- **THEN** the webview SHALL send the existing `replyQuestion` or
  `rejectQuestion` message
- **AND** the message SHALL contain the original question request identifier
  and answer shape
