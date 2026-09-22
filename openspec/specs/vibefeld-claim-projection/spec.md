# vibefeld-claim-projection Specification

## Purpose
Provide a bounded, host-private, manually requested claim-projection phase that keeps
logical structure separate from evidence status and never treats compatibility or
structural review as proof of external truth.

## Requirements

### Requirement: Compile and validate a bounded claim graph from visible response text

The host SHALL derive a private claim graph only from the existing bounded visible
assistant-text source packet for the selected completed message. The graph SHALL
separate claim classification, assumptions, logical dependencies, and evidence
dependencies, and SHALL enforce bounded text, node, edge, depth, identifier, and
claim-count limits. Duplicate identifiers, missing dependencies, cycles, invalid
claim classes, unsafe values, malformed input, and limit violations SHALL fail
closed without invoking AF or a model.

#### Scenario: A bounded visible source packet compiles

- **WHEN** a completed assistant message supplies visible text within the source
  packet limit and the text can be represented within the configured graph bounds
- **THEN** the host SHALL create a private graph with one bounded candidate
  conclusion, typed claim nodes, explicit assumptions, logical dependency edges,
  and separate evidence references
- **AND** the graph SHALL not be published through the webview protocol or exposed
  to an agent, plugin, MCP server, or model-visible tool

#### Scenario: The graph has a cycle, duplicate, missing dependency, or unsafe value

- **WHEN** graph compilation or validation encounters a duplicate identifier, a
  missing dependency, a logical dependency cycle, an unsupported claim class, an
  unsafe path/command/prompt/credential value, or an unbounded field
- **THEN** projection SHALL stop before any AF operation
- **AND** the controller SHALL publish only a bounded blocked or unresolved summary
  with no structural review claim and no invalid input echoed

#### Scenario: The source packet exceeds the graph limits

- **WHEN** the visible source packet or its compiled claim graph exceeds a
  configured character, node, edge, depth, or claim limit
- **THEN** the controller SHALL return a bounded non-structural result
- **AND** it SHALL not truncate material dependencies and continue as if validation
  had succeeded

### Requirement: Keep logical structure and evidence status independent

The host SHALL represent evidence dependencies separately from logical dependencies
and SHALL publish evidence status independently of any AF structural result. Source
metadata SHALL be bounded and SHALL not include source excerpts, raw tool output,
credentials, prompts, private reasoning, or unrestricted ledger data. Contradictory
evidence SHALL map to `conflicted` and SHALL never be upgraded by structural
compatibility or AF success.

#### Scenario: A claim has only recorded or unverified evidence

- **WHEN** a valid claim graph has an empirical, procedural, or otherwise
  evidence-dependent claim whose evidence is only recorded or unverified
- **THEN** the published evidence status SHALL remain `source_recorded` or
  `unverified`
- **AND** the review status SHALL be no stronger than `conditional`, even if a
  supported AF projection reports `structurally_checked`

#### Scenario: Evidence sources conflict

- **WHEN** separate evidence dependencies for a claim contain contradictory source
  status
- **THEN** the published evidence status SHALL be `conflicted`
- **AND** the result SHALL not claim that the conclusion is structurally checked or
  externally true

#### Scenario: A claim does not require external evidence

- **WHEN** a valid claim is limited to a declared logical structure and its
  evidence dependency state is `not_required` or `human_verified`
- **THEN** the evidence status SHALL remain that independent state
- **AND** it MAY permit a supported structural result to map to
  `structurally_checked` without changing the evidence status

### Requirement: Gate AF claim projection on an explicitly supported operation

The host SHALL invoke AF claim projection only through the private capability
seam, and only when the runtime bridge explicitly reports the contracted claim
projection capability. The bridge operation set SHALL be exactly `version`,
`schema`, `init`, `claim`, `refine`, and `status`, derived from the sanitized AF
0.1.11 capture set; successful `version`, `schema`, `init`, or `status` results
with `structuralStatus: null` SHALL NOT be treated as claim projection. No
unobserved verb, flag, output shape, or exit mapping SHALL be inferred from
documentation or workspace status. The fixture-derived test seam SHALL remain
test-only and SHALL NOT be wired into ordinary activation.

#### Scenario: The predecessor bridge has no claim operation

- **WHEN** the composed bridge reports no supported claim operation, or is
  dormant, incompatible, or unready
- **THEN** the controller SHALL stop after private graph and evidence validation
- **AND** it SHALL publish an `unavailable` or other non-structural summary
  stating that structural review was not performed
- **AND** it SHALL not publish `structurally_checked` or guess a claim operation

#### Scenario: A fixture/private seam explicitly supports claim projection

- **WHEN** a host-private bridge reports
  `{ supported: true, operation: "claim_projection" }` and a manual review
  request supplies a valid graph
- **THEN** the controller MAY project the validated graph through the seam's
  fixed sequence
- **AND** the seam SHALL not expose raw AF output, executable paths, workspace
  paths, commands, flags, ledgers, prompts, or model reasoning
- **AND** a fixture-only seam SHALL not be wired into ordinary activation

#### Scenario: AF claim projection fails or returns an ambiguous result

- **WHEN** a supported projection operation is missing, malformed, oversized,
  timed out, cancelled, signaled, policy-failed, cleanup-failed, audit-failed,
  or otherwise ambiguous
- **THEN** the controller SHALL map the result to `unavailable` or
  `audit_failed` according to the bounded failure classification
- **AND** it SHALL not synthesize a structural status or retry through the Chat
  sandbox, an unsandboxed process, a plugin, MCP, or a model-visible route

### Requirement: Publish calibrated provider-neutral review summaries

The controller SHALL publish a bounded `ReasoningReviewSummary` through the
existing manual reasoning-review route, keyed to the requested session and message.
The summary SHALL distinguish graph validation, structural result, and evidence
status, and SHALL include an interpretive boundary whenever a result could be read
as stronger than the evidence supports. No summary SHALL claim that compatibility,
structural checking, or a clean AF result proves a source, premise, citation,
empirical claim, or normative conclusion true.

#### Scenario: A supported structural result has adequate evidence state

- **WHEN** a valid graph receives an explicit supported `structurally_checked`
  result and all evidence-dependent claims are `not_required` or `human_verified`
- **THEN** the summary MAY use `structurally_checked`
- **AND** its conclusion SHALL say only that the recorded argument supports the
  conclusion under the stated assumptions
- **AND** it SHALL retain an interpretive boundary that this is not a truth or
  source-verification claim

#### Scenario: A structural result is paired with weak or conflicting evidence

- **WHEN** a valid graph receives a structural result while evidence is recorded,
  unverified, or conflicted
- **THEN** the summary SHALL map to no stronger than `conditional` for recorded or
  unverified evidence, or `unresolved` for conflicted evidence
- **AND** it SHALL publish the independent evidence status without upgrading it

#### Scenario: Validation or runtime failure is mapped safely

- **WHEN** graph validation fails or the private projection capability is
  unavailable, incompatible, or audit-failed
- **THEN** the summary SHALL use `blocked`, `unresolved`, `unavailable`, or
  `audit_failed` as appropriate
- **AND** it SHALL not use `structurally_checked`, `refuted`, or `conditional` to
  imply a successful structural projection that did not occur

### Requirement: Preserve manual post-response lifecycle and stale-state safety

The phase SHALL remain an explicit manual review of a completed assistant message
after the original response has been published. It SHALL reuse the existing host
session/message validation, cancellation, message-keyed publication, and webview
card. It SHALL not delay, gate, rewrite, or mutate the original response.

#### Scenario: A review is cancelled or becomes stale

- **WHEN** the user cancels a projection, switches sessions, deletes a session, or
  starts a newer review for the same session/message
- **THEN** the host SHALL cancel or invalidate the older private work
- **AND** a late result from that work SHALL not be published or replace current
  review state

#### Scenario: A request targets an invalid message

- **WHEN** a request names an inactive session, unknown message, non-assistant
  message, or incomplete assistant message
- **THEN** the host SHALL reject it before graph compilation or AF projection
- **AND** no source, graph, provider result, or error detail from the invalid target
  SHALL be published

### Requirement: Keep projection dormant and preserve security boundaries

Projection SHALL be host-owned and lazy. Ordinary activation, Chat, Write, Scout,
the research worker, MCP, the OpenCode agent interface, and the independent TUI
SHALL not gain AF or claim-projection authority beyond the constrained activation
wiring. This phase SHALL not modify workspace files, OpenCode/AF configuration,
nono profiles, user sandbox profiles, plugin sources, MCP configuration, or model
permissions. After activation, the host MAY inject the claim-projection controller
dynamically only when the pinned runtime is compatible, direct execution is
ready, and the bridge reports an explicitly supported claim operation; when the
claim capability is absent, the host SHALL retain the unavailable controller
and publish a bounded unavailable status, and when the runtime is dormant,
ordinary activation behavior SHALL be exactly as before.

#### Scenario: Ordinary activation does not request a review

- **WHEN** the extension activates or a normal Chat/Write interaction occurs
  without an explicit manual review request
- **THEN** no claim graph SHALL be compiled and no claim operation SHALL run
- **AND** the existing ordinary behavior and authority boundaries SHALL remain
  unchanged

#### Scenario: A model or tool asks to invoke claim projection

- **WHEN** a model, Scout, Write, worker, plugin, MCP server, or ordinary prompt
  requests a claim projection
- **THEN** no model-visible or agent-visible projection route SHALL exist
- **AND** only the existing host-owned manual review request may start the phase

#### Scenario: Configuration or profile changes would be required

- **WHEN** claim projection would require changing workspace/config/profile files,
  adding a plugin/MCP/tool, or broadening a sandbox permission
- **THEN** the phase SHALL remain unavailable
- **AND** those files, settings, permissions, and existing Chat behavior SHALL be
  left unchanged

#### Scenario: A ready runtime with a supported claim operation selects the projection controller

- **WHEN** activation resolves a compatible runtime with direct execution ready and the bridge reports an explicitly supported claim operation
- **THEN** the host MAY inject the claim-projection controller for manual review requests
- **AND** a dormant runtime or a runtime without a supported claim operation SHALL retain the unavailable controller with no projection attempt

### Requirement: Keep default verification fixture-only

Default focused and full test execution SHALL use sanitized checked-in fixtures,
deterministic graph inputs, and injected private seams only. Tests SHALL not require
an AF binary, user profile, network, global configuration, or active workspace proof
root. Any future live claim-operation test SHALL require the predecessor bridge's
explicit disposable runtime and dedicated-policy gates.

#### Scenario: Default tests run without claim-capable AF

- **WHEN** the test suite runs without explicit live integration inputs
- **THEN** tests SHALL verify graph validation, evidence separation, current
  no-claim-operation behavior, failure mapping, cancellation, stale-state safety,
  and security negatives from fixtures and fakes
- **AND** no AF process, shell, network request, profile access, or configuration
  write SHALL occur

#### Scenario: Live claim inputs are absent

- **WHEN** a live claim-capable runtime or independently validated policy is absent
- **THEN** live claim projection SHALL remain unrun or safely skipped
- **AND** default tests SHALL not weaken the no-capability result or claim that
  compatibility success proves truth

### Requirement: Derive structural results only from the contracted projection facts

The seam's projection SHALL run, in order and within one review root, only the
contracted operations: `init` with the graph's bounded conclusion statement,
`claim` of the root node with the host-fixed prover identity, one or more
bounded `refine` calls that record every remaining claim statement as a child of
the root, and a `status` read-back. It SHALL publish `structurally_checked` only
when every contracted operation succeeds, each refine response reports success
with the expected child count, and the status read-back reports exactly one node
plus the projected claim count. Any incomplete or unexpected read-back SHALL
publish `unresolved`; statements or counts outside the fixed argv bounds SHALL
publish a bounded non-structural outcome without truncation; bounded failures
SHALL publish `unavailable` or `audit_failed` per the bridge classification. A
projection SHALL NOT publish a structural status from compatibility,
initialization, status, or fixture facts alone.

#### Scenario: A validated graph projects cleanly

- **WHEN** the graph is valid, every statement is within the fixed bound, and
  the bridge completes initialization, claim, refine, and status with the
  expected counts
- **THEN** the seam SHALL publish `structurally_checked`
- **AND** the published summary SHALL retain the recorded-structure
  interpretive boundary and the independent evidence calibration

#### Scenario: A claim statement or count cannot be projected

- **WHEN** a graph statement exceeds the fixed bound or the projection would
  exceed the observed count limits
- **THEN** the projection SHALL stop before the out-of-bounds operation
- **AND** it SHALL publish a bounded non-structural outcome without truncating
  or silently dropping statements

#### Scenario: Projection is cancelled or the bridge fails

- **WHEN** the user cancels, the runtime changes, or any contracted operation
  returns unavailable, timed-out, cancelled, signaled, policy, cleanup, or
  audit failure
- **THEN** the seam SHALL publish `unavailable` or `audit_failed` according to
  the bridge classification
- **AND** it SHALL not synthesize `structurally_checked` or retry through Chat,
  an unsandboxed process, a plugin, MCP, or a model-visible route
