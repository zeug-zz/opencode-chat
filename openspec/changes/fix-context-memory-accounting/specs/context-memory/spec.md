## MODIFIED Requirements

### Requirement: ChatSession carries aggregate token data

The `ChatSession` domain type SHALL include an optional `tokens` field matching
the SDK `Session.tokens` shape. These values represent session-level aggregate
usage and MUST NOT be treated as the current context-window occupancy for the
context-memory chip.

#### Scenario: ChatSession tokens are accessible

- **GIVEN** a `ChatSession` object with `tokens: { input: 19857, output: 65, reasoning: 75, cache: { read: 22016, write: 0 } }`
- **WHEN** the state-based context memory calculation reads the token data
- **THEN** `getContextTokenCount(tokens)` returns `22121` (`input + cache.read`)
- **AND** the formatted string is computed correctly without treating the value as a cumulative chip total

#### Scenario: Cumulative session tokens do not inflate current context

- **GIVEN** the session aggregate contains token usage from multiple completed turns
- **WHEN** the current context-memory value is derived
- **THEN** the aggregate session total is not added to the latest context snapshot
- **AND** current occupancy is derived from the latest valid assistant or step snapshot instead

### Requirement: Multi-source context memory fallback

The context-memory chip MUST represent the latest valid context-window snapshot
for the active session, never the sum of prompt tokens across messages or steps.
For a single display update, sources SHALL be preferred in this order: (1)
non-zero server-provided `session.next.context.updated` text; (2) the latest
assistant message token snapshot from `message.updated` or loaded message state;
(3) the latest `session.next.step.ended` token snapshot. A token snapshot SHALL
be formatted using the project-defined prompt-context calculation (`input +
cache.read`) exactly once. `session.updated` aggregate token data MUST NOT be
used as a current-context source. A later valid snapshot replaces an earlier
snapshot, while repeated delivery of the same snapshot is idempotent. A
state-based fallback SHALL select the latest assistant message snapshot without
summing older messages.

#### Scenario: Latest assistant snapshot replaces older context

- **GIVEN** an active session has an older assistant snapshot of 12000 tokens
- **WHEN** a later assistant snapshot reports 20000 prompt-context tokens
- **THEN** the chip displays the later 20000-token value
- **AND** it does not display 32000 tokens

#### Scenario: Multiple tool-use steps use the latest snapshot

- **GIVEN** one assistant turn sends multiple model requests with prompt-context snapshots of 100000 and 120000 tokens
- **WHEN** the latest step completes
- **THEN** the chip reports approximately 120000 tokens, subject to the provider-reported fields
- **AND** it does not add the 100000-token snapshot to the 120000-token snapshot

#### Scenario: Repeated snapshot delivery is idempotent

- **GIVEN** the same step or assistant token snapshot is delivered more than once
- **WHEN** each delivery is processed
- **THEN** the chip remains at the snapshot's value
- **AND** repeated delivery does not increase the displayed token count

#### Scenario: Server context text has priority for the same update

- **GIVEN** an active session receives non-zero `session.next.context.updated` text and fallback token events for the same update
- **WHEN** the events are processed
- **THEN** the non-zero server-provided text is displayed as-is
- **AND** fallback token data does not accumulate into or overwrite that server value for the same update

#### Scenario: session.updated tokens update chip

- **GIVEN** an active session's `session.updated` event contains cumulative token usage from several turns
- **WHEN** the event is processed
- **THEN** the event may update ordinary session state
- **AND** `contextMemory` is not set from the cumulative session aggregate
- **AND** the chip retains or displays the latest assistant or step context snapshot

#### Scenario: State fallback selects the latest assistant snapshot

- **GIVEN** loaded messages contain multiple assistant messages with token data
- **WHEN** no authoritative context text is available
- **THEN** the chip uses the latest assistant message snapshot
- **AND** it does not sum token data from earlier assistant messages

#### Scenario: State fallback ignores zero tokens

- **GIVEN** `session.activeSession?.tokens` exists but the latest valid assistant snapshot is absent or `getContextTokenCount` returns 0
- **WHEN** the state-based effect runs
- **THEN** `setContextMemory` is not called with zero token data
- **AND** the last good context value is preserved

#### Scenario: Zero server text is ignored

- **GIVEN** a `session.next.context.updated` event has text `"0 (0%)"`
- **WHEN** the event is processed
- **THEN** the zero text is not displayed
- **AND** the last valid context value is preserved

#### Scenario: Compaction resets and repopulates the snapshot

- **GIVEN** an active session begins compaction with a previously displayed context value
- **WHEN** compaction starts
- **THEN** the chip is cleared
- **AND** when a post-compaction context text or token snapshot arrives, the chip displays that new snapshot rather than pre-compaction totals
