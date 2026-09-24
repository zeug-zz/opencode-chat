# vibefeld-reasoning-review Specification

## Purpose
Provide a provider-neutral, manually requested reasoning-review surface that is
safe and useful even when no external review runtime is installed or enabled.

## Requirements

### Requirement: Expose a provider-neutral reasoning-review contract

The system SHALL expose typed runtime, status, evidence, and summary data for a
reasoning review. Shared review data SHALL use only provider-neutral names and
an opaque artifact handle. It SHALL NOT expose an AF node identifier, executable
path, workspace path, command, flag, raw ledger, prompt, model reasoning trace,
or source-packet content through the shared contract or webview protocol.

#### Scenario: Review runtime is unavailable

- **WHEN** no compatible reasoning-review runtime is available
- **THEN** the system SHALL report an `unavailable` runtime state
- **AND** a requested review SHALL return an `unavailable` summary with a bounded
  user-safe reason
- **AND** ordinary Chat and Write operation SHALL remain available

#### Scenario: Provider-private review data exists

- **WHEN** a future review provider maintains implementation-specific artifact
  identifiers or metadata
- **THEN** the shared summary SHALL expose at most an opaque artifact handle
- **AND** the webview SHALL not receive provider-private paths, commands, or raw
  provider data

### Requirement: Keep review state scoped to its session and message

The system SHALL associate a valid reasoning-assist summary with exactly one
session, one submitted user prompt, and the resulting assistant response. It
SHALL ignore progress or summaries that no longer belong to the active session
or prompt generation and SHALL clear them when their session is deleted.
Cancelling or superseding assistance SHALL prevent a later result from replacing
the current prompt state.

#### Scenario: Result arrives after navigating away
- **WHEN** a reasoning-assist result arrives after the user has switched to
  another session
- **THEN** the result SHALL not render in the newly active session
- **AND** it SHALL not be associated with a prompt or response outside its
  original session

#### Scenario: User cancels an in-flight review
- **WHEN** a user submits, retries, or cancels a prompt that supersedes an
  in-flight reasoning assist
- **THEN** the host SHALL preserve ordinary prompt and message content
- **AND** a later completion from the superseded assist SHALL not overwrite the
  current prompt state

#### Scenario: User deletes a reviewed session
- **WHEN** the user deletes a session containing reasoning-assist summaries
- **THEN** the system SHALL clear those summaries and pending progress from host
  and webview state
- **AND** subsequent sessions SHALL not display them

### Requirement: Preserve existing authority boundaries in the scaffold

The scaffold contract itself SHALL NOT discover or launch an external runtime, create or write a proof workspace, create or modify configuration, add an OpenCode plugin source, MCP server, custom tool, or agent overlay, or change the permissions or sandbox policy of Chat, Scout, Write, the research worker, or the independent TUI. The activation change MAY replace the fixed unavailable-controller construction with the constrained, host-owned activation wiring defined by `vibefeld-activation` (pinned discovery, direct execution, mode-selected live parsers, global-storage proof store, one preflight, dynamic controller selection, availability-gated preference, and qualified routing). That substitution MUST NOT add any other runtime, plugin, MCP, custom tool, agent overlay, permission, or sandbox authority to the scaffold contract.

#### Scenario: Scaffold handles a review request

- **WHEN** the unavailable controller handles a manual review request and no runtime is ready
- **THEN** it SHALL not start a child process, access an AF executable, or write
  a proof workspace
- **AND** it SHALL not change configuration, launch configuration, plugin
  sources, MCP selection, agent permissions, or sandbox policy

#### Scenario: Existing Chat features are used without review

- **WHEN** the user does not request a reasoning review
- **THEN** existing Chat, Write, reasoning streaming, companion overlays,
  sandboxing, and independent TUI behavior SHALL remain unchanged

#### Scenario: Activation substitutes only the constrained contract wiring

- **WHEN** the activation change supplies the dynamic review controller and its host-owned wiring
- **THEN** only the documented discovery, direct-execution, parser, storage, preference, and qualified-routing paths SHALL be present
- **AND** plugin sources, MCP selection, custom tools, agent overlays, agent permissions, sandbox policy, and the independent TUI SHALL remain unchanged

### Requirement: Present reasoning assistance separately from model reasoning

The webview SHALL not provide a completed-message `Review argument` action or
render a generic post-response reasoning-review card. For a prompt with a valid
reasoning-assist brief, it SHALL render a localized compact row associated with
that prompt and resulting response. The row SHALL remain separate from streamed
model reasoning and expose only bounded user-facing progress and artifacts.

#### Scenario: A valid assist summary is available
- **WHEN** the host publishes a valid prompt-scoped reasoning-assist summary
- **THEN** the webview SHALL render its compact row only for that prompt and
  resulting response
- **AND** the user MAY expand or collapse the existing summary without starting
  further review work

#### Scenario: A normal response has no assist summary
- **WHEN** an ordinary, invalid, unavailable, or cancelled preflight produces no
  valid reasoning-assist brief
- **THEN** the webview SHALL render neither a `Review argument` action nor a
  persistent review card for that response

#### Scenario: User changes locale
- **WHEN** the webview renders reasoning-assist progress or summary content in a
  supported locale
- **THEN** every user-visible assist string SHALL be resolved through that
  locale's dictionary
