# vibefeld-adversarial-review Specification

## Purpose
Provide a host-owned, bounded adversarial review contract that can use independent prover and verifier contexts without widening Scribe's model, filesystem, process, or agent permissions.

## Requirements

### Requirement: Require an explicit restricted child-review capability and deny broad authority

The host SHALL accept a child-review adapter only when it explicitly supports the
`prover` and `verifier` roles and attests to an exact restricted permission
profile. The only production adapter SHALL be the internally constructed
host-owned `vibefeld-restricted-contexts` provider — it SHALL NOT be an
injection surface — and it SHALL report ready only through its
configuration-verified, generation-bound readiness preflight, revalidated before
each review and never described as enforced isolation. No fixture, test, or
third-party adapter SHALL be wired into activation. The attestation SHALL be
treated as a contract check, not as enforcement proof. A child context SHALL
receive only a bounded review packet and schema-constrained result channel; it
SHALL have no repository read or write access, shell, package manager, terminal,
arbitrary task delegation, AF workspace, plugin, MCP, or model-visible tool
authority. Stage-derived reason text SHALL be normalized with bounded, redacted
wording before projection, and raw child text SHALL NOT reach the published
summary. Host-configured plugins and MCP servers SHALL remain trusted host
extensions outside this boundary. Missing, extra, or permissive capability
fields SHALL fail closed.

#### Scenario: No reviewed child-model capability is supplied

- **WHEN** the extension starts or a manual review is requested without an
  explicitly attested restricted child-review adapter
- **THEN** no child context SHALL be created
- **AND** the existing unavailable-safe review behavior SHALL remain in effect
- **AND** no capability preflight, process launch, AF operation, workspace
  allocation, or configuration change SHALL occur

#### Scenario: An adapter requests a forbidden permission

- **WHEN** a supplied capability attestation grants repository access, shell,
  package, terminal, task delegation, AF workspace, plugin, MCP, or model-visible
  tool access, or contains unknown authority fields
- **THEN** the host SHALL reject the capability before creating a context
- **AND** it SHALL return an unavailable or audit-failed result without retrying
  through another authority path

#### Scenario: An adapter presents the exact restricted profile

- **WHEN** an injected adapter explicitly supports both roles and declares only
  bounded review-packet input and schema-constrained output with every forbidden
  authority denied
- **THEN** the host MAY create role-specific contexts
- **AND** the attestation SHALL remain private to the host and SHALL not be
  published through the core protocol or webview

#### Scenario: The host-owned restricted provider reports ready

- **WHEN** the host-owned provider's generation-bound preflight confirms the
  host-composed overlay and the restricted agent with every enumerated tool
  denied in the current generation
- **THEN** the host MAY create the prover and verifier contexts through that
  provider for a manual review
- **AND** a provider that is dormant, drifted, stale-generation, or unready SHALL
  keep the existing unavailable-safe behavior with no child context

### Requirement: Keep child inputs and results bounded and schema-constrained

The host SHALL send a child context only the existing bounded visible-text packet and validated private claim/evidence facts required for the review. It SHALL not send raw prompts, commands, argv, executable paths, workspace paths, credentials, tool payloads, private reasoning, or unrestricted ledgers. Prover objections and verifier verdicts SHALL use bounded schemas with approved identifiers, claim targets, severities, dispositions, provenance fields, and text limits. Unknown fields, unsafe values, malformed data, oversized data, or unrecognized targets SHALL be rejected without echoing the invalid payload.

#### Scenario: A bounded packet produces a valid objection proposal

- **WHEN** a restricted prover receives a bounded packet for a validated claim graph and returns only bounded objections targeting known claims or evidence dependencies
- **THEN** the host SHALL accept the normalized proposal as private review data
- **AND** it SHALL retain only the approved objection fields and provenance identity
- **AND** no child output or source packet content SHALL be published as a raw trace

#### Scenario: A child result contains unsafe or unbounded data

- **WHEN** a prover or verifier returns a command, path, prompt, credential, hidden-reasoning marker, unknown field, oversized string, unknown target, or malformed disposition
- **THEN** the host SHALL reject the result as unavailable or audit-failed
- **AND** it SHALL not continue with a guessed interpretation or expose the invalid value

### Requirement: Enforce independent provenance and reject self-acceptance

A prover and verifier SHALL run under distinct role identities and independently created context handles. The verifier SHALL not accept, reject, or finalize a proposal using the prover identity, the same context handle, or a context that is not explicitly marked as the verifier role. Any reused, missing, duplicated, or self-accepting provenance SHALL invalidate the review.

#### Scenario: Prover and verifier have distinct provenance

- **WHEN** the host creates one prover context and one verifier context with different validated provenance identities
- **THEN** the verifier SHALL receive the bounded packet and normalized prover proposal as review input
- **AND** the host SHALL record the result as independently evaluated private review data

#### Scenario: The verifier reuses the prover identity or context

- **WHEN** an adapter returns the same provenance identity, context handle, or role for both stages, or marks a prover proposal as accepted by the prover itself
- **THEN** the host SHALL reject the review
- **AND** it SHALL not publish an accepted challenge, structural success, or truth claim

### Requirement: Keep adversarial review manual, host-owned, and post-response

Only an explicit host-owned manual review of a completed assistant message MAY
start adversarial orchestration; automatic routing SHALL NOT invoke the
adversarial controller, and the controller SHALL reject any non-manual trigger.
The verifier SHALL evaluate bounded proposal data rather than receive an
unconstrained command or model prompt. Selection SHALL preserve the existing
claim-projection capability: when claim projection is available it retains
selection; when only the restricted provider is ready, the manual review SHALL
select the adversarial controller and compile the bounded private claim graph
for the prover and verifier stages; otherwise the bounded unavailable controller
SHALL remain. Selection and status reads SHALL stay side-effect free, and
readiness SHALL be revalidated for the current generation before a review starts.
Adversarial review SHALL not be exposed through `IAgent`, OpenCode task
delegation, plugins, MCP, custom tools, Scout, Write, the research worker, or
ordinary model prompts, and SHALL not delay, rewrite, gate, or mutate the
original response.

#### Scenario: A normal interaction occurs without a manual request

- **WHEN** the extension activates or a normal Chat, Write, Scout, worker, or
  model interaction occurs without an explicit review request
- **THEN** no prover or verifier context SHALL be created
- **AND** no claim graph, AF preflight, proof workspace, child-model request, or
  review configuration SHALL be created
- **AND** existing behavior and permission boundaries SHALL remain unchanged

#### Scenario: An automatic trigger occurs

- **WHEN** automatic routing is configured and a response qualifies for
  automatic post-processing
- **THEN** the adversarial controller SHALL not be invoked and SHALL reject the
  non-manual trigger
- **AND** no child context, model request, or review configuration SHALL be
  created

#### Scenario: A manual request targets a completed active assistant message

- **WHEN** the host validates a manual request for a completed assistant message
  in the active session and an explicitly available restricted adapter is
  generation-ready
- **THEN** the host MAY run the prover stage followed by the verifier stage using
  the bounded private packet
- **AND** the original assistant message SHALL remain unchanged and already
  published
- **AND** the webview SHALL receive only the existing bounded review summary
  shape with redacted reason text

#### Scenario: Selection precedence for a ready provider

- **WHEN** the restricted provider is ready and the claim projection capability
  is also available
- **THEN** the claim-projection controller SHALL retain selection so the
  AF-backed structural result is not downgraded
- **AND** the adversarial controller SHALL be selected only when claim projection
  is unavailable, with selection remaining side-effect free until the manual
  request arrives and no context, session, or model call created at activation

### Requirement: Fail closed across cancellation, failure, and stale work

Cancellation, timeout, malformed output, model failure, provenance failure, policy failure, ambiguous verdict, or cleanup failure SHALL prevent forced acceptance. The host SHALL map such outcomes to unavailable, audit-failed, or unresolved results as appropriate, SHALL cancel both role contexts when possible, and SHALL never retry through the Chat sandbox, an unsandboxed process, a generic task, a plugin, MCP, or a model-visible route. A late result SHALL be discarded when its session/message review token is stale.

#### Scenario: A review is cancelled or times out

- **WHEN** the user cancels the review or a bounded prover/verifier operation reaches its timeout
- **THEN** the host SHALL invalidate the in-flight review and request context cancellation
- **AND** no late proposal or verdict SHALL be published
- **AND** the result SHALL not be treated as accepted or structurally checked

#### Scenario: A child fails or returns an ambiguous verdict

- **WHEN** a child model fails, returns malformed data, violates provenance, or produces a verdict that cannot be safely normalized
- **THEN** the host SHALL publish only a bounded unavailable, audit-failed, or unresolved summary
- **AND** it SHALL not force acceptance, synthesize an objection, or retry with broader authority

### Requirement: Publish calibrated summaries without conflating adversarial review and truth

A completed adversarial review SHALL reuse the existing provider-neutral summary and evidence fields. Accepted or unresolved objections SHALL remain visible as bounded open challenges; recorded, unverified, or conflicted evidence SHALL remain independent of the child verdict. Adversarial review SHALL never publish `structurally_checked` as a consequence of child agreement, and no result SHALL claim that a source, premise, citation, empirical claim, normative conclusion, or original response is true or formally proved.

#### Scenario: The verifier confirms a material objection

- **WHEN** the verifier independently confirms a bounded major or critical objection against the claim graph
- **THEN** the summary SHALL use an unresolved or otherwise calibrated non-structural status
- **AND** it SHALL include only the bounded challenge target, severity, and safe reason
- **AND** its evidence status SHALL remain the separately normalized evidence status

#### Scenario: The verifier rejects all proposed objections

- **WHEN** both roles complete with distinct provenance and the verifier rejects every bounded proposal without an evidence conflict
- **THEN** the summary MAY use a conditional status indicating that no objection was confirmed under the stated assumptions
- **AND** it SHALL retain an interpretive boundary that this is not source verification, truth, or formal proof

#### Scenario: Evidence is recorded, unverified, or conflicted

- **WHEN** a child verdict is available but evidence dependencies are only recorded, unverified, or conflicted
- **THEN** the summary SHALL preserve that evidence status
- **AND** it SHALL not upgrade to structural success or claim that adversarial agreement validates the evidence

### Requirement: Keep verification fixture-only and side-effect free by default

Default tests and ordinary activation SHALL use sanitized fixtures, deterministic bounded adapters, and injected cancellation seams only. They SHALL not require an AF binary, child-model service, network, user profile, global configuration, active workspace proof root, shell, or absolute temporary directory. Any live child-model integration SHALL remain separately gated by a reviewed adapter and permission boundary.

#### Scenario: The default suite runs without a child-model service

- **WHEN** focused or full tests run without explicit live integration inputs
- **THEN** tests SHALL exercise capability rejection, provenance separation, schema validation, safe mapping, cancellation, stale-result handling, and security negatives using fakes or fixtures
- **AND** no child process, network request, shell command, AF operation, or configuration write SHALL occur

#### Scenario: Live child-model prerequisites are absent

- **WHEN** a reviewed hidden child-model API or independently enforced permission boundary is absent
- **THEN** live adversarial review SHALL remain unavailable or be safely skipped
- **AND** default behavior SHALL not weaken its permissions or claim that a fixture result represents production child-model support
