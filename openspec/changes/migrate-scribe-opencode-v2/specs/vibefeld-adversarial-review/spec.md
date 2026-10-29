## REMOVED Requirements

### Requirement: Run a bounded critic during a valid prompt preflight

## MODIFIED Requirements

### Requirement: Require an explicit restricted child-review capability and deny broad authority

The host SHALL accept a child-review adapter for reasoning assistance only when
it explicitly attests to an exact restricted permission profile and supports
the host-owned architect and prover/verifier review stages. The only production
adapter SHALL be the internally constructed `vibefeld-restricted-contexts`
provider; it SHALL NOT be an injection surface. Each child context SHALL
receive only a bounded host-built packet and return schema-constrained data. It
SHALL have no repository read or write access, shell, package manager,
terminal, task delegation, AF workspace or output, plugin, MCP, web, Hindsight,
`execute`, or model-visible tool authority. Raw child text SHALL not reach the
Scout request or webview. Architect, critic, verifier, and manual-review stages
SHALL use OpenCode's native resolved effective default model through its
location-bound server API, pinned and validated against the current connection
generation. This honors a configured OpenCode default without requiring a
literal top-level `model` field. No Scribe-specific model setting, config
write, arbitrary first-catalog-model fallback, or Scribe UI-selected model is
permitted. Null, malformed, or failed resolution produces visible
unavailability with a fixed reason. Restricted
readiness SHALL be tied to the active server generation and SHALL be rebound
and rechecked after every successful connect.

#### Scenario: No reviewed child-model capability is supplied

- **WHEN** an eligible prompt or manual review is requested without an
  explicitly attested restricted adapter
- **THEN** no restricted child context SHALL be created
- **AND** normal prompt dispatch SHALL continue or the manual review SHALL
  return a bounded unavailable result

#### Scenario: An adapter requests a forbidden permission

- **WHEN** a supplied capability attestation grants a forbidden authority or
  contains unknown authority fields
- **THEN** the host SHALL reject the capability before creating a context
- **AND** it SHALL not retry through another authority path

#### Scenario: An adapter presents the exact restricted profile

- **WHEN** the host-composed overlay and native location-bound API
  confirm the exact restricted profile and resolved effective default model for the
  active server generation
- **THEN** the host MAY create the relevant hidden stage context
- **AND** readiness SHALL remain configuration-level evidence, not a claim of
  enforced isolation

#### Scenario: The host-owned restricted provider reports ready

- **WHEN** the host-owned provider's generation-bound preflight confirms the
  restricted agent with the complete deny map and resolved effective default model
- **THEN** the provider MAY create a hidden architect or manual-review stage
  context
- **AND** readiness SHALL remain configuration-level evidence and SHALL make
  no claim of enforced isolation

#### Scenario: Native default-model resolution is unavailable

- **WHEN** native effective-default-model resolution is null, malformed, or fails
- **THEN** architect/reviewer availability SHALL be false with a visible
  bounded unavailable reason
- **AND** no Scribe-specific model, arbitrary catalog fallback, or UI-selected model SHALL be selected

#### Scenario: Reconnect or sandbox change advances the generation

- **WHEN** a successful connect, sandbox toggle, or event recovery changes the
  server generation
- **THEN** the restricted-review holder SHALL rebind and rerun readiness,
  cancel in-flight work from the old generation, and republish
  `reasoningRuntime`
- **AND** stop/failure SHALL invalidate the holder and no stale holder SHALL be
  used

### Requirement: Keep adversarial review host-owned during prompt preparation

The host SHALL own architect preparation, AF recording, manual-review packet
construction, and result normalization. Automatic reasoning-assist preparation
SHALL NOT run a critic or verifier and SHALL NOT include reviewer objections in
the ephemeral brief. The only additional reasoning routes SHALL be (a) exact
on-demand critic/verifier task targets available to Scout under the companion
delegation policy and (b) a typed user-requested manual review of a completed
answer. Manual review SHALL be host-routed through its typed protocol. Neither
route SHALL create an automatic post-response audit, hold or rewrite an answer,
or expose AF or its output to a model. No model, tool, plugin, MCP server,
worker, Write agent, or independent TUI may request the host review provider
through any other route.

#### Scenario: A normal prompt is admitted

- **WHEN** the host starts the model-free pre-screen and architect for an
  eligible Scout prompt
- **THEN** the host SHALL admit the prompt without waiting for a critic or
  verifier
- **AND** it SHALL not place critic/verifier objections in the brief

#### Scenario: A valid prompt requires critique

- **WHEN** a validated argument graph warrants critique and Scout explicitly
  chooses the exact hidden critic target
- **THEN** the critic MAY run as a separate bounded background call
- **AND** the automatic preflight SHALL not require it or add its objections
  to the ephemeral brief

#### Scenario: Scout requests a reviewer for a warranted turn

- **WHEN** Scout chooses to invoke the exact hidden critic or verifier target
  because it is warranted for the current turn
- **THEN** only that bounded role's schema-valid result MAY be returned to Scout
- **AND** each role SHALL be called at most once in that turn

#### Scenario: A completed answer is explicitly reviewed

- **WHEN** the user requests `Review argument` for a completed assistant answer
- **THEN** the host SHALL execute only the typed manual-review path
- **AND** it SHALL not delay, hold, rewrite, or automatically re-audit the
  completed answer

#### Scenario: An unsupported caller requests adversarial review

- **WHEN** a model, tool, plugin, MCP server, worker, Write agent, or TUI
  requests the host review provider outside the exact Scout subagent targets or
  typed manual-review protocol
- **THEN** the host SHALL reject the route without creating a child context
- **AND** it SHALL expose no model-visible AF route

#### Scenario: A non-preflight route requests a critic

- **WHEN** a non-preflight caller other than the exact Scout critic target
  requests a critic, or manual Review argument requests a Scout critic instead
  of its prover/verifier stages
- **THEN** the host SHALL reject that route without creating a critic context
- **AND** the explicit manual-review route SHALL remain limited to its typed
  prover/verifier pipeline

## ADDED Requirements

### Requirement: Expose exact on-demand reasoning subagents to Scout

Only Scout SHALL receive hidden targets `chat-reasoning-critic` and
`chat-reasoning-verifier`. Scout MAY invoke each once per warranted turn; calls
MAY run in the background. They SHALL use the same OpenCode-native resolved
effective default via the location-bound server API, pinned to the current
generation. They SHALL return schema-bounded output and deny `execute`, tools,
and delegation. Write, the research worker, and other agents SHALL receive
neither targets nor elevated results.

#### Scenario: Scout invokes one exact reasoning target

- **WHEN** Scout delegates to exact `chat-reasoning-critic` or
  `chat-reasoning-verifier` for a warranted current turn
- **THEN** the requested hidden subagent MAY return only its validated bounded
  schema result
- **AND** that role SHALL not be invoked more than once during the turn

#### Scenario: A reasoning subagent attempts a forbidden capability

- **WHEN** either reasoning subagent attempts file access, MCP/web access,
  `execute`, AF, Hindsight, shell, plugin, package, terminal use, or further
  delegation
- **THEN** the effective policy SHALL deny the capability
- **AND** malformed or unbounded output SHALL be discarded without echoing it

#### Scenario: The caller is not Scout or the target is not exact

- **WHEN** Write, the research worker, another agent, or the independent TUI
  requests either target, or Scout names a similarly named/unlisted target
- **THEN** delegation SHALL be denied
- **AND** no child session SHALL be created

### Requirement: Offer manual Review argument as a secondary message action

The webview SHALL offer localized `Review argument` only as a secondary action
on completed assistant messages, never as a large/prominent primary button on
every answer. It SHALL send a typed host request; all new UI strings SHALL be
localized.

#### Scenario: Review remains a secondary message action

- **WHEN** message actions are rendered for completed assistant answers, incomplete answers, or non-assistant messages
- **THEN** localized `Review argument` SHALL appear only as a secondary action for a completed assistant answer, not as a large/prominent primary button on every answer

### Requirement: Keep manual review typed and bounded

Manual review SHALL preserve AF claim authority and expose bounded prover/verifier
objections only as `openChallenges`. It SHALL reuse cancellation, stale-result
cleanup, and the existing 60-second total / 30-second stage budgets. It SHALL NOT
gate or rewrite an answer, automatically re-audit it, expose raw child output, or
create a model-visible AF route.

#### Scenario: A completed answer receives an explicit manual review

- **WHEN** the user selects `Review argument` for a completed assistant answer
- **THEN** the host SHALL frame the answer as untrusted completed-answer data,
  not current user text, and map it with the existing generation-bound architect
  packet builder/parser
- **AND** it SHALL validate the resulting claim graph before running AF
- **AND** the typed host request SHALL run the bounded AF claim projection and
  prover/verifier review
- **AND** the AF claim projection SHALL remain authoritative while normalized
  prover/verifier objections appear only as `openChallenges`

#### Scenario: A review is cancelled, stale, or exceeds its budget

- **WHEN** the user cancels, a newer answer/session supersedes the request, the
  generation changes, a stage reaches 30 seconds, or total review reaches 60
  seconds
- **THEN** the host SHALL cancel/clean up its hidden sessions and discard late
  results
- **AND** it SHALL publish only a bounded unavailable or cancelled result
  without holding or changing the completed answer

#### Scenario: AF or a restricted stage is unavailable

- **WHEN** AF projection or the required restricted reviewer is unavailable,
  malformed, or not ready for the active generation
- **THEN** the manual review SHALL return a bounded unavailable result
- **AND** it SHALL not invent AF status, fall back to broader authority, or
  expose model-visible AF access

#### Scenario: Completed-answer mapping is ineligible or invalid

- **WHEN** the selected answer is ordinary, malformed, unsafe, or exceeds the
  architect packet bounds, or the architect result does not parse as a valid
  claim graph
- **THEN** the manual review SHALL return a bounded unavailable result without
  invoking AF
- **AND** an over-limit answer SHALL be refused whole rather than truncated

#### Scenario: A review result is published

- **WHEN** a valid manual review completes
- **THEN** only provider-neutral normalized claim/review fields and bounded
  `openChallenges` SHALL be sent through the typed result
- **AND** no raw packet, prompt, child text, paths, AF ledger, or credentials
  SHALL reach the webview or model

### Requirement: Keep main-answer copy and omit auxiliary copy controls

The webview SHALL preserve existing main-answer copy behavior and SHALL NOT
provide dedicated review-result or thinking Markdown copy controls.

#### Scenario: Only main-answer copy remains

- **WHEN** the webview renders a completed answer, a manual-review result, or a visible reasoning segment
- **THEN** the existing main-answer copy action SHALL remain available with unchanged clipboard behavior
- **AND** no dedicated `Copy review as Markdown` or `Copy thinking as Markdown` action SHALL be rendered

#### Scenario: Compressed review packet omits citations and source findings

- **WHEN** a verifier reviews the normalized compressed graph and evidence-status metadata, without the full answer or source contents
- **THEN** the verifier SHALL distinguish an incomplete compressed packet from a defect in the original report and SHALL NOT confirm an objection solely from omitted raw citation content
- **AND** actual insufficiency MAY remain unresolved, while substantive graph and empirical-support weaknesses remain assessable
- **AND** the fixed public Review limits SHALL disclose compression; no content guarantee, proof of fidelity, added source/tool/model call, packet/schema expansion, raw review data, or AF route is implied, and AF authority remains unchanged
