## REMOVED Requirements

### Requirement: Fallback when independent TUI cannot start
**Reason**: The companion is restricted; attaching the unrestricted TUI to it is neither independent nor a safe capability escalation.
**Migration**: Use independently verified V2 export/import or surface an unavailable error while leaving Chat connected.

#### Scenario: Attach fallback uses active session
- **WHEN** independent handoff fails and fallback attach is used
- **THEN** the terminal MUST run `opencode attach <companionUrl> --session <activeSessionId>` without creating a companion fork solely for isolation
- **AND** the extension MUST NOT replace the shell-resolved command with an absolute OpenCode path

## ADDED Requirements

### Requirement: Do not attach the independent TUI to the restricted companion
The handoff MUST import a verified compatible session copy into an independent V2 TUI or report handoff unavailable. It MUST NOT expose the authenticated restricted companion URL/session attach as a fallback, and MUST NOT put server credentials in terminal arguments, command text, or shell history.

#### Scenario: Independent import cannot be proven
- **WHEN** export/import fails, is unsupported, or cannot prove independent session isolation
- **THEN** the user receives a bounded actionable failure and the companion remains connected
- **AND** no attach command to the restricted server is offered or executed

## MODIFIED Requirements

### Requirement: Primary handoff is independent session copy
The primary terminal handoff path MUST open a full independent V2 OpenCode process using a copy of session data, not attach to the restricted companion. The export representation MUST match the selected V2 release's verified import contract; the extension MUST NOT assume a fixed `info`+`messages` shape unless the runtime spike proves it.

#### Scenario: Export then independent TUI
- **WHEN** the user triggers terminal handoff with an active session and connected companion
- **THEN** the extension MUST export a session snapshot sourced via the companion without stopping it
- **AND** MUST launch a terminal command that imports the snapshot into an independent V2 instance and starts its TUI on the resulting session
- **AND** MUST NOT require `forkSession` on the companion for the happy path

#### Scenario: Export uses info+messages shape
- **WHEN** the extension writes a handoff export file
- **THEN** its serialized shape MUST be the exact shape verified compatible with the selected V2 `import` operation
- **AND** if that contract does not use `info` and `messages`, implementation and evidence MUST use the verified shape rather than preserving the legacy assumption
