# vibefeld-adversarial-review Specification

## Purpose
Provide a host-owned, bounded adversarial review contract that can use independent prover and verifier contexts without widening Scribe's model, filesystem, process, or agent permissions.

## Requirements

### Requirement: Require an explicit restricted child-review capability and deny broad authority

The host SHALL accept a child-review adapter for reasoning assistance only when
it explicitly attests to an exact restricted permission profile and supports
the host-owned architect and critic stages. The only production adapter SHALL be
the internally constructed `vibefeld-restricted-contexts` provider; it SHALL NOT
be an injection surface. Each child context SHALL receive only a bounded
host-built packet and return schema-constrained data. It SHALL have no repository
read or write access, shell, package manager, terminal, task delegation, AF
workspace, plugin, MCP, or model-visible tool authority. Raw child text SHALL
not reach the Scribe request or webview.

#### Scenario: No reviewed child-model capability is supplied
- **WHEN** an eligible prompt is dispatched without an explicitly attested
  restricted adapter
- **THEN** no child context SHALL be created
- **AND** the host SHALL continue normal prompt dispatch without critic output

#### Scenario: An adapter requests a forbidden permission
- **WHEN** a supplied capability attestation grants a forbidden authority or
  contains unknown authority fields
- **THEN** the host SHALL reject the capability before creating a context
- **AND** it SHALL not retry through another authority path

#### Scenario: An adapter presents the exact restricted profile
- **WHEN** an internally constructed adapter supports only the host-owned
  architect and critic stages with every forbidden authority denied
- **THEN** the host MAY create the relevant hidden stage context after the
  generation-bound readiness check succeeds
- **AND** the attestation SHALL remain private to the host

#### Scenario: The host-owned restricted provider reports ready
- **WHEN** the host-owned provider's generation-bound preflight confirms the
  configured restricted agent and exact deny map
- **THEN** the host MAY create architect and critic contexts for a valid prompt
  preflight
- **AND** readiness alone SHALL not be described as enforced isolation

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

### Requirement: Run a bounded critic during a valid prompt preflight

Only the host MAY request one critic stage after it has validated an argument
graph for an eligible prompt. The critic SHALL receive the bounded graph and no
raw user prompt, tool content, attachment, command, path, credential, AF output,
or private reasoning. It SHALL return at most two bounded objections targeting
known claims or assumptions. Invalid, unsafe, oversized, unavailable, cancelled,
or timed-out critic output SHALL be omitted rather than converted into an
accepted finding or persistent error.

#### Scenario: A valid graph receives bounded objections
- **WHEN** a generation-ready restricted adapter receives a valid argument graph
- **THEN** the host MAY run one critic stage and normalize at most two objections
  targeting known graph elements
- **AND** the resulting brief SHALL characterize them as objections to address or
  qualify rather than true or verified facts

#### Scenario: Critic work fails
- **WHEN** the critic fails, returns malformed output, exceeds its deadline, or
  becomes stale
- **THEN** the host SHALL cancel and clean up its context
- **AND** it SHALL continue with the valid argument brief without a critic fact

### Requirement: Keep adversarial review host-owned during prompt preparation

Reasoning-assist criticism SHALL run only as a bounded host-owned preflight
before the normal Scribe request. It SHALL not be exposed through `IAgent`, task
ordinary model prompts. It SHALL not create a post-response gate, mutate an
already-published answer, or start a verifier stage.

#### Scenario: A valid prompt requires critique
- **WHEN** the host holds a valid argument graph and a ready restricted adapter
- **THEN** it SHALL complete or bound the critic stage before adding any critic
  fact to the normal Scribe brief
- **AND** the normal Scribe response SHALL stream after preflight completion

#### Scenario: A non-preflight route requests a critic
- **WHEN** a manual message review, automatic post-response route, model, tool,
  plugin, MCP server, or worker requests a critic
- **THEN** the host SHALL reject that route without creating a child context
