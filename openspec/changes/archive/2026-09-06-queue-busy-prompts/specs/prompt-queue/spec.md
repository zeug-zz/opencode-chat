## Purpose

Preserve prompts submitted during an active Chat or Write turn and deliver them in session-scoped FIFO order without changing the existing send payload or agent boundaries.

## ADDED Requirements

### Requirement: Normal prompts are admitted while a session is active

The extension MUST accept a valid normal `sendMessage` for a session whose prompt is busy or has been admitted but whose busy status has not arrived. When another prompt is already active or pending for that session, the new prompt MUST be stored rather than forwarded concurrently. A normal send for an idle session with no pending prompt MUST continue to be forwarded immediately.

#### Scenario: Prompt submitted while busy is queued

- **WHEN** the user submits a valid normal prompt while the selected session is busy
- **THEN** the prompt MUST be accepted and stored for that session
- **AND** the agent MUST NOT receive that prompt before the active turn reaches its matching idle boundary
- **AND** the webview MUST receive the pending count for that session

#### Scenario: Rapid prompts before busy status are serialized

- **WHEN** the user submits multiple normal prompts before the first submission's busy status event arrives
- **THEN** the first prompt MUST be admitted as the active prompt
- **AND** each later prompt MUST be stored in arrival order
- **AND** the agent MUST NOT receive overlapping prompt calls for that session

#### Scenario: Idle session sends immediately

- **WHEN** the user submits a valid normal prompt for an idle session with no pending prompts
- **THEN** the agent MUST receive that prompt without waiting for a queue status event
- **AND** the existing send payload shape MUST be used

### Requirement: Queued prompts preserve payload and session identity

Each queued prompt MUST preserve the complete normal send payload as it was submitted, including text, model, effort, files, mentioned agent, primary agent, skill, bundled command invocation, and explicit system override when present. A queued prompt MUST remain associated with its original session and MUST NOT be dispatched to a different active session. Queue state MUST be held in memory and MUST survive a webview rerender while the extension host remains alive.

#### Scenario: Queued payload retains model and context

- **WHEN** a prompt containing model, effort, files, agent, primary agent, skill, command, and system values is queued
- **AND** the user changes any corresponding current input selection before the prompt is dispatched
- **THEN** the dispatched prompt MUST retain the original values
- **AND** the dispatched prompt MUST target the original session

#### Scenario: Session switching cannot retarget pending work

- **WHEN** a prompt is queued for session A and the active session changes to session B before an idle event arrives
- **THEN** the prompt MUST remain associated with session A
- **AND** no status event for session B MUST dispatch the prompt for session A
- **AND** a prompt submitted for session B MUST remain independent of session A's queue

#### Scenario: Deleting a queued session drops its pending prompts

- **WHEN** session A is deleted while it has pending prompts
- **THEN** all pending prompts for session A MUST be discarded
- **AND** no later status event MUST dispatch them
- **AND** the webview MUST receive a zero pending count for session A when that count is observable

### Requirement: Matching idle status drains exactly one prompt in FIFO order

The extension MUST use the matching session's terminal `session.status: idle` event as the queue drain boundary. For each idle transition that ends an admitted active prompt, the extension MUST dispatch at most one pending prompt, mark it active before dispatch, and preserve the remaining prompts in FIFO order. A duplicate idle event without a new active transition MUST NOT dispatch another prompt. Status events for another session or non-idle states MUST NOT drain the queue.

#### Scenario: One idle transition dispatches only the next prompt

- **WHEN** two prompts are pending for session A and its active turn reaches `session.status: idle`
- **THEN** exactly the first pending prompt MUST be dispatched
- **AND** the second prompt MUST remain pending
- **AND** the first prompt MUST be marked active before its agent call is started

#### Scenario: FIFO order continues across idle transitions

- **WHEN** pending prompts A1, A2, and A3 are admitted in that order
- **AND** session A reaches a matching idle boundary for each completed active turn
- **THEN** the agent MUST receive A1, then A2, then A3 in that order
- **AND** no later prompt may bypass an earlier pending prompt

#### Scenario: Duplicate or foreign idle does not drain

- **WHEN** an idle event is repeated for a session that has already reached idle without a new active transition
- **OR** an idle event arrives for a session other than the queued session
- **THEN** no additional pending prompt MUST be dispatched
- **AND** the queued session's pending count and ordering MUST remain unchanged

### Requirement: Abort preserves the queue and uses the idle boundary

Stop MUST continue to abort only the active prompt for the selected session. Aborting MUST NOT discard pending prompts, MUST NOT dispatch one immediately after the abort request, and MUST allow the matching idle transition caused by the abort to perform the normal one-item drain.

#### Scenario: Stop drains the next prompt only after idle

- **WHEN** session A has an active prompt and one or more pending prompts
- **AND** the user activates Stop
- **THEN** the host MUST send the existing abort operation for session A
- **AND** no pending prompt MUST be sent before the matching idle event
- **AND** exactly the next FIFO prompt MUST be sent after that idle event

#### Scenario: Stop with no pending prompts is unchanged

- **WHEN** the active session has no pending prompts
- **AND** the user activates Stop
- **THEN** the existing abort behavior MUST be preserved
- **AND** no queue prompt MUST be synthesized or sent

### Requirement: Dispatch failure does not silently skip work

If dispatching an active or queued prompt fails, the extension MUST clear the active-send guard so the session is not permanently blocked, MUST retain the failed prompt as the first pending item rather than silently dropping or bypassing it, and MUST use the existing bounded host error path. The failure handler MUST NOT dispatch a later pending prompt as an implicit skip.

#### Scenario: Failed queued prompt remains at the head

- **WHEN** the next FIFO prompt fails during agent dispatch
- **THEN** that prompt MUST remain the first pending item
- **AND** later prompts MUST remain behind it
- **AND** the webview MUST continue to receive an accurate pending count
- **AND** the existing error handling MUST be invoked

#### Scenario: Failed dispatch releases admission

- **WHEN** an agent dispatch rejects before the session becomes busy
- **THEN** the active-send guard MUST be released
- **AND** the failed payload MUST not be lost
- **AND** no unrelated session MUST be affected

### Requirement: Queue status is session-scoped and visible in the shared input

The host MUST expose pending queue counts through a typed host-to-webview message containing the session ID and count. It MUST publish an updated count when a prompt is admitted, dispatched, removed by deletion, or otherwise becomes zero, and MUST republish the active session's count during webview initialization. The webview MUST show a compact localized `Queued: N` status only when the count for the active session is positive, clear it on a zero count or active-session change, and keep the count separate from the existing `sendMessage` payload.

#### Scenario: Pending count is displayed for the active session

- **WHEN** the host reports a positive queued count for the active session
- **THEN** the input controls MUST show a localized queued-count indicator containing that count
- **AND** the indicator MUST be compact and accessible

#### Scenario: Count is scoped to the active session

- **WHEN** the host reports a queued count for a different session
- **THEN** the webview MUST NOT display that count for the current session
- **AND** changing to a session with zero pending prompts MUST clear the indicator

#### Scenario: Webview initialization restores the visible count

- **WHEN** the webview becomes ready again while the host still owns pending prompts for its active session
- **THEN** the host MUST republish that session's current count
- **AND** the webview MUST render the restored count without requiring a new prompt submission

### Requirement: Existing input, mode, and protocol boundaries remain compatible

Queueing MUST apply only to normal `sendMessage` operations. The extension MUST leave edit-and-resend, session operations, shell routing, permission handling, MCP behavior, sandbox behavior, agent permissions, and independent TUI behavior unchanged. Enter during IME composition MUST still avoid submission, while Enter outside composition MUST use the existing send path even when the session is busy. Chat and Write MUST share the behavior while preserving the submitted primary-agent value.

#### Scenario: Busy Enter uses the normal send path

- **WHEN** the user presses Enter outside IME composition while the session is busy
- **THEN** the input MUST submit through the existing normal send path
- **AND** the host MUST decide whether to forward or queue it
- **AND** the input MUST retain its existing clearing and attachment behavior

#### Scenario: IME composition still suppresses Enter

- **WHEN** the user presses Enter while IME composition is active
- **THEN** no normal send MUST be submitted
- **AND** queue admission MUST NOT occur

#### Scenario: Write payload keeps its mode

- **WHEN** a Write-mode prompt is queued while the session is busy
- **THEN** its original `primaryAgent: "build"` value MUST be preserved when dispatched
- **AND** a Chat-mode prompt MUST likewise preserve its original `primaryAgent: "scout"` value

#### Scenario: No native delivery migration is required

- **WHEN** the queue capability is enabled
- **THEN** the extension MUST continue using the existing normal send and abort contracts
- **AND** it MUST NOT require a newer SDK delivery field, persistence migration, or OpenCode configuration-file write
