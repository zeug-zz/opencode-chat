## MODIFIED Requirements

### Requirement: Fallback when independent TUI cannot start
If independent handoff cannot start while companion remains up, the system MUST provide a fallback that opens TUI attached to the companion server for the **active** session (no automatic companion fork). The fallback terminal command MUST use the shell-resolved `opencode` command name rather than an absolute executable path, so user shell policy hooks can apply.

#### Scenario: Attach fallback uses active session
- **WHEN** independent handoff fails and fallback attach is used
- **THEN** the terminal MUST run `opencode attach <companionUrl> --session <activeSessionId>` without creating a companion fork solely for isolation
- **AND** the extension MUST NOT replace the shell-resolved command with an absolute OpenCode path

### Requirement: Terminal launch reliability
Terminal handoff commands MUST use the shell-resolved `opencode` command name and MUST avoid sending keystrokes before the shell is ready when the platform APIs allow. The extension MUST NOT use an absolute OpenCode path for commands sent to the integrated terminal, because doing so can bypass user-defined shell policy wrappers.

#### Scenario: Shell policy wrapper receives independent continuation
- **WHEN** launching the independent TUI in an integrated terminal
- **THEN** the host MUST send `opencode --continue` or the equivalent `opencode -c` command name and arguments to the terminal shell
- **AND** a user shell function, alias, or hook for `opencode` MUST be able to receive and wrap the command
- **AND** the host MUST NOT send a resolved absolute OpenCode path for this terminal command

#### Scenario: Normal shell resolves OpenCode
- **WHEN** the integrated terminal has no `opencode` wrapper but can resolve `opencode` through its normal shell PATH
- **THEN** the handoff MUST start the usual independent OpenCode TUI with the imported session

#### Scenario: Shell command cannot be resolved
- **WHEN** the integrated terminal cannot resolve the `opencode` command
- **THEN** the handoff failure MUST remain visible to the user
- **AND** the extension MUST NOT retry the command with an absolute OpenCode path that would bypass shell policy

#### Scenario: Shell-resolved command used
- **WHEN** launching a handoff terminal command
- **THEN** the host MUST invoke the shell-resolved `opencode` command name
- **AND** the host MUST NOT prefer or send an absolute OpenCode path that would bypass shell policy

#### Scenario: Shell-ready send
- **WHEN** the terminal is created for handoff
- **THEN** the host SHOULD delay or wait for shell integration before `sendText` so the command is not lost
