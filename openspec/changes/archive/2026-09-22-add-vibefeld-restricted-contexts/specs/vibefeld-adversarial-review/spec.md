## MODIFIED Requirements

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
