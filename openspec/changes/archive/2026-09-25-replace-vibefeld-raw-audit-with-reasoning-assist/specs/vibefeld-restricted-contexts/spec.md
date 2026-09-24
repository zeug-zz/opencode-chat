# Spec Delta

## REMOVED Requirements

### Requirement: Run provenance-distinct, bounded, cancellable stages
**Reason**: The v2 workflow replaces the two-stage prover/verifier review with
one architect stage and at most one critic stage.
**Migration**: The bounded architect/critic stage requirement retains deadlines,
exact parsing, hidden contexts, cancellation, cleanup, and no-retry behavior
without verifier provenance or an accepted verdict.

## MODIFIED Requirements

### Requirement: Provide a hidden restricted child-context provider over the extension-owned server

The host MAY declare exactly one restricted-review agent overlay inside the
extension-owned OpenCode server's in-memory configuration for the architect and
critic stages. The overlay SHALL deny every known tool and dynamically present
tool name in addition to the `"*"` wildcard, reject unknown authority entries,

#### Scenario: The restricted overlay is built
- **WHEN** the host composes its server configuration for reasoning assistance
- **THEN** the restricted agent SHALL exist only in the in-memory configuration
  with every enumerated tool denied and host-pinned model and instructions
- **AND** it SHALL not appear in a user-visible agent list or modify configuration
  files, profiles, plugins, MCP servers, or custom tools

#### Scenario: An overlay is permissive or unknown
- **WHEN** the overlay grants any tool, omits the deny map, supplies an
  unexpected field, names an unknown authority, or uses a non-host-owned model
  or instruction channel
- **THEN** the host SHALL reject it before any context is created
- **AND** ordinary prompt dispatch SHALL continue without hidden assistance

## ADDED Requirements

### Requirement: Run bounded architect and critic stages

The provider SHALL create one host-private context for an architect stage and,
Each stage SHALL receive only its bounded packet, use a provider-enforced
deadline, validate exact schema output, and discard raw text after host
normalization. The stage instructions SHALL enumerate every bounded enum value
the schema validates - claim classes, evidence source kinds, evidence statuses,
objection severities, and objection target kinds - so a hidden stage can comply
without guessing, and the enumerated literals SHALL match the host parser's
frozen enums. The architect instruction SHALL request the smallest sufficient
argument map - bounded soft counts for claims, assumptions, evidence needs, and
uncertainty items, and short statements - so generation fits the stage deadline.
It SHALL mint stage identities that are bounded, letter-leading,
webview. A preflight SHALL have at most two live child sessions, no automatic
retry, and a bounded total timeout.

#### Scenario: Architect and critic stages complete
- **WHEN** a generation-ready provider runs a valid architect result followed by
  a valid critic stage
- **THEN** it SHALL retain only normalized host-private stage data needed for the
  compact assist brief
- **AND** it SHALL not retain or publish raw child output, packets, paths, or
  model reasoning

#### Scenario: Stage instructions enumerate their validated enums
- **WHEN** a hidden stage receives its instruction
- **THEN** every enum the host schema validates SHALL be spelled out in the
  instruction with its exact allowed values
- **AND** the instruction literals SHALL be pinned to the host parser's frozen
  enum constants by a cross-package test

#### Scenario: A stage fails or is cancelled
- **WHEN** a stage returns malformed, oversized, unsafe, or ambiguous data, the
  stage deadline expires, or the prompt is cancelled or superseded
- **THEN** the provider SHALL abort and delete every context it created and drop
  late results
- **AND** it SHALL not retry through the Chat sandbox, task delegation, plugin,
  MCP, or an unsandboxed process

### Requirement: Read stage results only after the hidden reply completes

The stage transport SHALL treat a hidden stage reply as a stage result only
after the assistant message reports completion, either through its
message-level completion timestamp or through an end timestamp on every one of
its text parts. When the server exposes neither marker, the transport SHALL
require the same non-empty text across a fixed number of consecutive polls
before returning it. Retrieval SHALL respect the provider-enforced deadline, and
no partial streamed reply SHALL reach schema validation.

#### Scenario: A streaming reply is not returned early
- **WHEN** the hidden assistant message is still streaming without completion
  markers
- **THEN** the transport SHALL keep polling within the stage deadline
- **AND** it SHALL NOT return partial text for schema validation

#### Scenario: A completed reply is returned once
- **WHEN** the assistant message reports completion
- **THEN** the transport SHALL return its full bounded text as the stage result

#### Scenario: A reply never completes
- **WHEN** no completion marker or bounded stability is reached within the stage
  deadline
- **THEN** the transport SHALL fail the stage as a bounded timeout

## MODIFIED Requirements

### Requirement: Keep child sessions hidden and unretained

The provider SHALL register every created child session id with the host at
creation, and the extension SHALL filter registered ids from session-list
mapping, agent lists, and webview event publication. Child sessions SHALL use
fixed host-private marker titles containing only a random token. Every preflight
SHALL abort and delete its child sessions regardless of outcome, extension
deactivation SHALL await disposal, and startup SHALL scavenge leftover marked
sessions. The host SHALL not persist stage packets, raw architect results, raw
critic output, or traces; it MAY publish only the bounded reasoning-assist
summary.

#### Scenario: Child sessions exist during a review
- **WHEN** the host holds an architect or critic child session, including one
  whose creation event arrives before registration resolves
- **THEN** the extension's session list, agent list, and webview SHALL not
  surface it or its events

#### Scenario: A review or the extension ends
- **WHEN** a preflight completes, fails, times out, or is cancelled, or the
  extension deactivates with work in flight
- **THEN** the host SHALL abort and delete every created child session and await
  disposal on deactivation
- **AND** no packet, raw stage output, or trace SHALL remain persisted
