# Spec Delta

## REMOVED Requirements

### Requirement: Publish calibrated provider-neutral review summaries
**Reason**: The manual `ReasoningReviewSummary` route is retired with raw
completed-response parsing and cannot represent a prompt-scoped preflight.
**Migration**: The new reasoning-assist capability publishes only its bounded
prompt-scoped progress and compact summary contract.

### Requirement: Preserve manual post-response lifecycle and stale-state safety
**Reason**: Claim projection is now an optional bounded enrichment of a valid
prompt preflight rather than a completed-message manual operation.
**Migration**: Prompt tokens and generation guards in reasoning assistance own
cancellation, stale-result rejection, and response association.

### Requirement: Keep projection dormant and preserve security boundaries
**Reason**: Its manual-only routing language is superseded by the host-owned
automatic prompt-preflight capability while the same authority boundaries remain.
**Migration**: `vibefeld-reasoning-assist` defines the eligible prompt route and
preserves the prohibition on model-visible AF authority.

## MODIFIED Requirements

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
