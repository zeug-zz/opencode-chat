# vibefeld-response-gate Specification

## Purpose
Provide an explicit, host-owned, opt-in transactional lifecycle that can
withhold an eligible assistant response until a bounded calibrated review has
completed, without misrepresenting the current streaming path or widening any
authority boundary.

## Requirements

### Requirement: Establish a real transactional insertion point

The host MUST expose a typed capability-gated insertion point where a response
is held as a draft before publication and where only the host-owned release
operation can publish it. The capability MUST report unavailable or
incompatible when it can only observe an already streamed response. The current
`promptAsync`/direct-send path, post-stream hook, prompt wording, ordinary task
delegation, and manual review card MUST NOT be described as a response gate.

#### Scenario: Current streaming path has no transactional seam

- **WHEN** an assistant response is delivered through the existing immediate
  streaming path without a proven host publication boundary
- **THEN** the response MUST remain ordinary, unchanged behavior
- **AND** no gated-delivery claim MUST be published
- **AND** no post-stream or prompt-level approximation MUST withhold or relabel it

#### Scenario: A typed host seam can hold publication

- **WHEN** an explicitly injected capability proves that draft creation precedes
  host-owned publication and exposes compatible bounded lifecycle operations
- **THEN** an eligible response MAY enter the gate transaction
- **AND** the host MUST retain release authority until an allowed decision

### Requirement: Require explicit opt-in and capability compatibility

The host MUST enter a transaction only for an explicitly opted-in eligible
response and a capability that passes the exact private compatibility checks.
Missing, unavailable, or incompatible capability MUST leave ordinary Chat and
Write behavior unchanged and MUST report no claim that delivery was gated.
Automatic selection/routing and general mandatory gating MUST remain disabled.

#### Scenario: Gate capability is absent

- **WHEN** ordinary Chat or Write runs without an explicitly configured eligible
  gate
- **THEN** the existing direct behavior MUST continue unchanged
- **AND** no draft, review, token, AF preflight, proof workspace, child request,
  or configuration mutation MUST be created

#### Scenario: Configured capability is incompatible

- **WHEN** an opt-in response is selected but the capability cannot prove a
  transactional insertion point or required lifecycle operation
- **THEN** the host MUST fail closed without claiming gated delivery
- **AND** it MUST NOT retry through broader authority or alter ordinary behavior

### Requirement: Enforce draft ownership, bounded input, and isolation

Every transaction MUST have one opaque single-use token, one owner, one active
session identity, and one assistant message identity. The draft MUST be
immutable and bounded, and the source packet MUST use the existing bounded
visible-text semantics. Session, message, owner, token, and transaction
generation mismatches MUST be stale and MUST NOT publish or mutate a draft.

#### Scenario: Draft is created for an eligible response

- **WHEN** the host accepts a compatible opt-in request
- **THEN** it MUST create an owned `draft` transaction with a single-use token
- **AND** it MUST withhold publication while retaining only bounded immutable
  candidate/source data

#### Scenario: Session or message changes during review

- **WHEN** the active session changes, the message is deleted/replaced, or a
  newer transaction supersedes the old one
- **THEN** the old token MUST become stale and terminally non-releasable
- **AND** no late review result MUST publish the old response

### Requirement: Require a precise lifecycle and single-use release

The transaction MUST support `draft`, `reviewing`, `approved`, `released`,
`cancelled`, `timed_out`, `failed`, and `audit_failed` states with explicit
ownership and terminal transitions. Only `approved` may transition to
`released`. Release MUST consume the token and publish exactly once; repeated,
concurrent, stale, or terminal release attempts MUST be rejected.

#### Scenario: Valid review releases once

- **WHEN** a valid calibrated decision is received for the current owned
  transaction
- **THEN** the transaction MAY enter `approved`
- **AND** the host MUST release the immutable original candidate exactly once
- **AND** the token MUST be unusable for a second release

#### Scenario: Release is attempted before an allowed decision

- **WHEN** the transaction is `draft`, `reviewing`, cancelled, timed out, failed,
  audit-failed, stale, or has an ambiguous decision
- **THEN** release MUST be rejected
- **AND** the response MUST NOT be published by the gate

### Requirement: Reuse calibrated adversarial-review semantics

Review MUST use the existing bounded adversarial-review handoff and reasoning-
review summary semantics. Confirmed or unresolved objections, evidence
conflicts, malformed or ambiguous outcomes, and audit failures MUST prevent
release. Adversarial agreement MUST NOT create a truth/proof status, upgrade
evidence, or publish `structurally_checked` or a truth claim.

#### Scenario: Review confirms a material objection

- **WHEN** the verifier confirms a bounded major or critical objection
- **THEN** the host MUST retain a bounded unresolved/non-structural summary
- **AND** the transaction MUST NOT become releasable
- **AND** evidence status MUST remain independently normalized

#### Scenario: Review rejects all objections under stated assumptions

- **WHEN** distinct valid roles complete and no objection is confirmed
- **THEN** the result MAY be calibrated as conditional with its interpretive
  boundary
- **AND** only then MAY the transaction become `approved`
- **AND** the summary MUST not claim source verification, truth, or formal proof

### Requirement: Fail closed on cancellation, timeout, failure, and audit error

Cancellation, timeout, model failure, malformed or unsafe output, provenance
failure, cleanup failure, stale work, and audit failure MUST invalidate the
transaction before release. The host MUST not force acceptance or retry through
Chat sandbox, unsandboxed process, generic task, plugin, MCP, or model-visible
authority. Late results MUST be discarded.

#### Scenario: User cancels or review times out

- **WHEN** cancellation is requested or a bounded review deadline expires
- **THEN** the transaction MUST enter `cancelled` or `timed_out`
- **AND** the token MUST become non-releasable
- **AND** no late proposal, verdict, or release MUST be published

#### Scenario: Review result is malformed or audit-failed

- **WHEN** a result is ambiguous, malformed, unsafe, incompatible, or cleanup
  auditing fails
- **THEN** the transaction MUST enter `failed` or `audit_failed`
- **AND** no guessed interpretation, broader retry, or release MUST occur

### Requirement: Protect publication and diagnostic boundaries

The gate MUST preserve the original response immutability and MUST publish only
the existing bounded response/review surface. It MUST never publish raw prompts,
private reasoning, source packets, AF paths/commands/ledgers, child payloads,
credentials, transaction tokens, or unsafe diagnostics. Vibefeld-specific
types/orchestration SHOULD remain private to the VS Code platform Vibefeld
modules.

#### Scenario: A valid release occurs

- **WHEN** a current transaction reaches `approved` and the host release
  callback succeeds
- **THEN** the original candidate MUST be published unchanged exactly once
- **AND** only safe calibrated summary data MAY accompany it

#### Scenario: Invalid data crosses the boundary

- **WHEN** input or output includes forbidden raw content or unsafe diagnostics
- **THEN** it MUST be rejected without echoing the value
- **AND** it MUST not reach the webview, shared protocol, logs, or publication

### Requirement: Keep activation and verification fixture-only by default

Ordinary activation and default tests MUST not wire an unavailable or fixture
adapter into normal extension behavior. The end-to-end fixture MUST use an
in-memory injected transaction and deterministic review, with no AF binary,
child service, network, user profile, active workspace proof root, shell, or
absolute `/tmp` path. Focused and full verification MUST cover unchanged
fallback behavior and valid withhold-then-release behavior.

#### Scenario: Fixture proves the lifecycle without external prerequisites

- **WHEN** the fixture starts an explicitly injected eligible transaction
- **THEN** publication MUST be withheld during `draft`/`reviewing`
- **AND** one valid calibrated decision MUST release exactly once
- **AND** a second release and all invalid terminal paths MUST fail
- **AND** no external process, network, filesystem, or profile side effect MUST occur

#### Scenario: Normal extension activation occurs

- **WHEN** the extension activates without a reviewed live gate provider
- **THEN** the unavailable/manual behavior MUST remain dormant and safe
- **AND** ordinary Chat, Write, Scout, worker, MCP, sandbox, AF, configuration,
  nono/profile, and independent TUI boundaries MUST remain unchanged
