# vibefeld-claim-projection Specification

## Purpose
Provide a bounded, host-private, manually requested claim-projection phase that keeps
logical structure separate from evidence status and never treats compatibility or
structural review as proof of external truth.

## Requirements

### Requirement: Compile and validate a bounded claim graph from visible response text

For reasoning assistance, the host SHALL derive a private claim graph only from
a schema-valid bounded architect result for the submitted prompt. The graph
SHALL separate claim classification, assumptions, logical dependencies, and
evidence dependencies, and SHALL enforce bounded text, node, edge, depth,
identifier, and claim-count limits. Duplicate identifiers, missing dependencies,
cycles, invalid claim classes, unsafe values, malformed input, and limit
violations SHALL stop AF and critic work without preventing the normal response.

#### Scenario: A bounded visible source packet compiles
- **WHEN** the architect returns a result within the configured graph bounds
- **THEN** the host SHALL create a private graph with one bounded candidate
  conclusion, typed claim nodes, explicit assumptions, logical dependency edges,
  and separate evidence references
- **AND** the graph SHALL not be published through the webview protocol or
  exposed to an agent, plugin, MCP server, or model-visible tool

#### Scenario: The graph has a cycle, duplicate, missing dependency, or unsafe value
- **WHEN** graph validation encounters a duplicate identifier, a missing
  dependency, a logical dependency cycle, an unsupported claim class, an unsafe
  value, or an unbounded field
- **THEN** projection and critique SHALL stop before any AF operation or child
  context creation
- **AND** the host SHALL dispatch the unchanged prompt without publishing a
  structural claim or `blocked` state

#### Scenario: The source packet exceeds the graph limits
- **WHEN** the architect result or its graph exceeds a configured character,
  node, edge, depth, or claim limit
- **THEN** the host SHALL stop assistance before the out-of-bounds operation
- **AND** it SHALL not truncate material dependencies and continue as if
  validation had succeeded

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

When a valid reasoning-assist graph is recorded through the contracted AF
projection operations, the host SHALL describe a clean expected read-back only
as `recorded structure`. It SHALL not map that recording to
`structurally_checked`, proof, source verification, or semantic validation,
because the current contracted bridge records a root and child statements but
does not represent the graph's dependencies or challenges. Incomplete or
unexpected read-back, out-of-bounds data, and bounded bridge failures SHALL omit
the AF fact without blocking the normal response.

#### Scenario: A validated graph projects cleanly
- **WHEN** the graph is valid and the bridge completes its contracted recording
  sequence with expected counts
- **THEN** the reasoning-assist brief and webview summary MAY state that AF
  recorded the structure
- **AND** they SHALL retain the independent evidence and uncertainty boundaries

#### Scenario: A claim statement or count cannot be projected
- **WHEN** a validated graph contains a statement or count outside the
  contracted AF recording bounds
- **THEN** the host SHALL omit the AF recorded-structure fact without truncating
  a claim or dependency
- **AND** it SHALL continue normal dispatch from the validated local graph

#### Scenario: Projection is cancelled or the bridge fails
- **WHEN** the bridge is unavailable, unready, malformed, oversized, timed out,
  cancelled, signaled, policy-failed, cleanup-failed, or otherwise ambiguous
- **THEN** the host SHALL omit the AF recorded-structure fact
- **AND** it SHALL not retry through a broader authority path, publish a
  structural result, or prevent the normal response
