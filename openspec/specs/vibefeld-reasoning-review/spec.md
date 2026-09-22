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

### Requirement: Accept only authorized manual review requests

The system SHALL accept a manual reasoning-review request only for a completed
assistant message in the requested active session. Before invoking the review
controller, the host SHALL verify the session and message association and derive
a bounded source packet from visible assistant text only. The source packet
SHALL exclude reasoning parts, tool inputs and outputs, attachments, permission
metadata, and raw prompts.

#### Scenario: User reviews a completed assistant response

- **WHEN** the user requests a review for a completed assistant message in the
  active session
- **THEN** the host SHALL invoke the review controller with that message's
  bounded visible assistant text
- **AND** the resulting summary SHALL identify the reviewed message

#### Scenario: Request targets another session or an invalid message

- **WHEN** a review request names an inactive session, an unknown message, a
  non-assistant message, or an incomplete assistant message
- **THEN** the host SHALL reject the request
- **AND** the review controller SHALL not be invoked
- **AND** no message, tool, or session data from the invalid target SHALL be
  published to the webview

### Requirement: Keep review state scoped to its session and message

The system SHALL associate each review result with exactly one session and one
assistant message. It SHALL ignore a result that no longer belongs to the active
session and SHALL clear review state when its session is deleted. Cancelling a
review SHALL prevent a later result for that request from replacing current
state.

#### Scenario: Result arrives after navigating away

- **WHEN** a review result arrives after the user has switched to another
  session
- **THEN** the result SHALL not render in the newly active session
- **AND** it SHALL not be associated with any message outside its original
  session

#### Scenario: User cancels an in-flight review

- **WHEN** the user cancels an in-flight review for a message
- **THEN** the system SHALL preserve ordinary message content
- **AND** a later completion from the cancelled request SHALL not overwrite the
  message's current review state

#### Scenario: User deletes a reviewed session

- **WHEN** the user deletes a session containing review summaries
- **THEN** the system SHALL clear those summaries from host and webview state
- **AND** subsequent sessions SHALL not display them

### Requirement: Present review results separately from model reasoning

The webview SHALL provide a localized `Review argument` action for a completed
assistant message and render a compact reasoning-review card below only its
matching message. The card SHALL visibly distinguish unavailable, reviewing,
structurally checked, conditional, unresolved, refuted, blocked, and audit
failed states. It SHALL remain separate from streamed model reasoning content.

#### Scenario: Unavailable scaffold review is requested

- **WHEN** the user selects `Review argument` while the unavailable controller
  is active
- **THEN** the webview SHALL render an unavailable review card below the selected
  assistant message
- **AND** the card SHALL not imply that the original response was reviewed before
  delivery

#### Scenario: Review belongs to another assistant message

- **WHEN** a summary is published for one assistant message
- **THEN** the card SHALL render below that message only
- **AND** it SHALL not alter or appear inside another message's streamed
  reasoning view

#### Scenario: User changes locale

- **WHEN** the webview renders the review action or card in a supported locale
- **THEN** every user-visible review string SHALL be resolved through that
  locale's dictionary

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
