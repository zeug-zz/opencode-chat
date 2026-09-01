# session-navigation Specification

## Purpose

Provide deterministic session creation and navigation in the chat webview when session data, messages, and reconnect refreshes complete asynchronously.

## Requirements

### Requirement: Latest session intent wins

The chat experience MUST keep the session associated with the latest completed user intent to create or select a session active. A response from an earlier create or select intent MUST NOT replace a newer active session.

#### Scenario: A later session selection completes first

- **WHEN** the user selects session A and then selects session B before both session lookups complete
- **THEN** completion of the B selection MUST make B active, and a later completion of the A selection MUST NOT make A active

#### Scenario: Creating a session supersedes an earlier refresh

- **WHEN** the user creates session B while a refresh for the previously active session A is in progress
- **THEN** B MUST remain active after both operations complete, and the refresh MUST NOT publish A as the active session

#### Scenario: Selection failure does not replace the current session

- **WHEN** a requested session lookup fails
- **THEN** the last valid active session MUST remain active and the existing error handling MUST remain usable

### Requirement: Session-scoped responses stay current

The chat experience MUST apply session lists, messages, and session-scoped auxiliary data only when the response belongs to the current session operation. Older responses MUST NOT overwrite data produced by a newer operation.

#### Scenario: Stale messages do not replace the selected session

- **WHEN** messages for session A complete after the user has selected session B
- **THEN** the webview MUST not display the A messages as B's messages

#### Scenario: Stale session list does not hide a newly created session

- **WHEN** a session list response started before a new session was created completes after the creation response
- **THEN** the visible session list MUST retain the newly created session when it is present in the current session state

#### Scenario: Current session receives one coherent load

- **WHEN** the active session changes or is refreshed
- **THEN** the webview MUST settle on data for that session without competing duplicate loads causing visible oscillation

### Requirement: Session changes do not trigger redundant initialization

Changing the active session MUST NOT re-run the webview initialization handshake solely because the active session ID changed. Refreshes caused by reconnect or explicit environment refresh MUST preserve the most recent active session instead of restoring a session captured before the change.

#### Scenario: Selecting a session does not start another ready cycle

- **WHEN** the webview receives the active-session result for a user selection
- **THEN** it MUST update session-scoped state without sending another initialization-ready request solely for that selection

#### Scenario: Reconnect refresh preserves a newer selection

- **WHEN** a reconnect refresh overlaps a session selection
- **THEN** the refresh MUST preserve and publish the newer selection, while still allowing unrelated initialization data to refresh

### Requirement: Header actions remain usable with the session list open

The session-list dismissal surface MUST NOT intercept clicks on the ChatHeader. The new-session action MUST remain available and MUST send the existing create-session request when the list is visible.

#### Scenario: New session from an open list

- **WHEN** the user opens the session list and clicks the visible new-session button in the header
- **THEN** the list MUST close and the existing create-session action MUST be sent

#### Scenario: Session selection still dismisses the list

- **WHEN** the user selects a session from the list
- **THEN** the list MUST close and the selected session request MUST be sent
