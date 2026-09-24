# Spec Delta

## REMOVED Requirements

### Requirement: Enforce independent provenance and reject self-acceptance
**Reason**: The reasoning-assist path uses one bounded critic result rather than
a prover/verifier adjudication. Independent verification is deferred until live
quality evidence justifies its additional cost and latency.
**Migration**: Valid preflight graphs may receive one schema-constrained critic
stage; no verifier context or accepted verdict is produced.

### Requirement: Keep adversarial review manual, host-owned, and post-response
**Reason**: The v2 critic must inform the normal answer before it streams, so the
manual completed-message lifecycle cannot provide the intended writing aid.
**Migration**: Only the host-owned prompt preflight may create one critic stage;
manual and post-response routes are removed.

## MODIFIED Requirements

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

## ADDED Requirements

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
