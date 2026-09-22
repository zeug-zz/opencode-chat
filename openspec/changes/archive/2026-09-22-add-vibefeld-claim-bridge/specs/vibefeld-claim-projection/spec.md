## MODIFIED Requirements

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

## ADDED Requirements

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
