# Spec Delta

## REMOVED Requirements

### Requirement: Accept only authorized manual review requests
**Reason**: Completed-answer raw-prose parsing cannot reliably produce the
private graph grammar and yields an unusable `blocked` outcome for normal Scribe
responses.
**Migration**: Eligible prompts use the automatic `vibefeld-reasoning-assist`
preflight before normal answer streaming. Completed messages no longer offer a
manual `Review argument` request.

### Requirement: Present review results separately from model reasoning
**Reason**: The completed-message action and status card represent a post-response
workflow that cannot parse ordinary Scribe prose and leaves persistent unusable
`blocked` output.
**Migration**: Valid preflight results render through the prompt-scoped
reasoning-assist row; ordinary and unavailable prompts render no review affordance.

## MODIFIED Requirements

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

## ADDED Requirements

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
