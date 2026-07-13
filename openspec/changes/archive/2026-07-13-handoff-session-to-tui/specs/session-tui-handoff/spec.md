## ADDED Requirements

### Requirement: Handoff keeps companion chat running
When the user hands an active chat session off to terminal OpenCode, the extension MUST NOT stop, close, or disconnect the companion OpenCode server as part of that action.

#### Scenario: Successful handoff leaves companion connected
- **WHEN** a handoff completes (export succeeds and terminal is opened)
- **THEN** the companion agent connection MUST still be available for subsequent chat operations

#### Scenario: Failed handoff leaves companion connected
- **WHEN** handoff fails during export or independent TUI start
- **THEN** the companion agent connection MUST still be available
- **AND** the extension MUST NOT tear down the companion to recover

### Requirement: Primary handoff is independent session copy
The primary terminal handoff path MUST open a full independent OpenCode process using a **copy** of session data, not `opencode attach` to the companion server as the happy path.

#### Scenario: Export then independent TUI
- **WHEN** the user triggers terminal handoff with an active session and connected companion
- **THEN** the extension MUST export session snapshot data sourced via the companion (not by stopping companion)
- **AND** MUST launch a terminal command that imports that snapshot into an independent OpenCode instance and starts TUI on the resulting session
- **AND** MUST NOT require `forkSession` on the companion for the happy path

#### Scenario: Export uses info+messages shape
- **WHEN** the extension writes a handoff export file
- **THEN** the JSON MUST include session `info` and `messages` compatible with `opencode import`

### Requirement: User-visible progress and errors
Handoff MUST show progress during export and MUST surface failures to the user (not only the extension host console).

#### Scenario: Export progress
- **WHEN** handoff starts
- **THEN** the host MUST show a VS Code progress or equivalent indication while exporting

#### Scenario: Missing prerequisites
- **WHEN** companion server URL is missing or there is no active session
- **THEN** the host MUST show an error or warning
- **AND** MUST NOT open a terminal with an invalid attach/import command silently

#### Scenario: Independent start failure surfaces message
- **WHEN** independent import/TUI cannot start (including project database lock)
- **THEN** the user MUST receive a clear error message explaining the failure

### Requirement: Fallback when independent TUI cannot start
If independent handoff cannot start while companion remains up, the system MUST provide a fallback that opens TUI attached to the companion server for the **active** session (no automatic companion fork).

#### Scenario: Attach fallback uses active session
- **WHEN** independent handoff fails and fallback attach is used
- **THEN** the terminal MUST run `opencode attach <companionUrl> --session <activeSessionId>` without creating a companion fork solely for isolation

### Requirement: Terminal launch reliability
Terminal handoff commands MUST use a resolvable OpenCode binary and MUST avoid sending keystrokes before the shell is ready when the platform APIs allow.

#### Scenario: Absolute binary preferred
- **WHEN** launching a handoff terminal command
- **THEN** the host SHOULD invoke an absolute path to `opencode` when one can be resolved

#### Scenario: Shell-ready send
- **WHEN** the terminal is created for handoff
- **THEN** the host SHOULD delay or wait for shell integration before `sendText` so the command is not lost
