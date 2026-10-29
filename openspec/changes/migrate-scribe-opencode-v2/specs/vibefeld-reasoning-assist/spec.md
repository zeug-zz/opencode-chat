## MODIFIED Requirements

### Requirement: Classify and map eligible prompts before normal dispatch

For an eligible Scout text prompt, the host SHALL first apply a deterministic,
model-free pre-screen that may skip only obvious greetings, thanks,
acknowledgements, or empty/near-empty turns. It SHALL NOT skip a prompt based on
length alone. For every other eligible prompt, the existing restricted
architect SHALL remain the sole semantic classifier and SHALL return either
`ordinary` or a schema-valid argument map. It SHALL run in parallel with prompt
admission, not as a prerequisite to admission. The pre-screen and architect
input SHALL contain only the new user text, a bounded same-session context
window, and an existing compact same-thread assist summary when present. They
SHALL not receive attachments, tool content, private reasoning, host paths,
credentials, AF output, or unrestricted session history. A valid argument map
SHALL contain a bounded candidate conclusion, typed claims, assumptions,
dependencies, evidence needs, and uncertainty boundaries. The host SHALL
validate the map before AF recording. The architect SHALL use OpenCode's native
resolved effective default model through its location-bound server API, pinned and
validated against the current connection generation. This honors a configured
OpenCode default without requiring a literal top-level `model` field. No
Scribe-specific model setting, config write, arbitrary first-catalog-model
fallback, or Scribe UI-selected model is permitted. Null, malformed, or failed
resolution yields visible unavailability with a fixed reason and ordinary
prompt dispatch.

The architect result SHALL be parsed as exact JSON, either directly or from
exactly one outer Markdown code fence with an optional case-insensitive `json`
label, a newline before and after the body, and no non-whitespace outside the
fence. The original result text remains subject to the existing length bound;
fence removal SHALL NOT relax any schema, key, type, safety, or graph check.
Prose-wrapped JSON and multiple fences remain malformed.

The fixed architect-stage instruction SHALL state that `conclusionId` and each
assumption/evidence `claimId` identify listed claims; `dependsOn` names only
other listed claims that directly support the dependent claim, never assumption
IDs; every listed claim is reachable from the conclusion by following
`dependsOn`; cycles are forbidden; and unsupported premises use `dependsOn: []`.

#### Scenario: An ordinary prompt receives normal dispatch

- **WHEN** an eligible Scout prompt is an obvious greeting, thanks,
  acknowledgement, or empty/near-empty turn
- **THEN** the model-free pre-screen SHALL return ordinary without creating an
  architect, AF, or reviewer context
- **AND** the host SHALL dispatch the unchanged prompt without an assist UI or
  added pre-send latency

#### Scenario: Prompt length alone cannot skip semantic classification

- **WHEN** an eligible Scout prompt is not an obvious conversational turn,
  regardless of whether it is short or long
- **THEN** the host SHALL schedule the existing architect as the sole semantic
  classifier in parallel with normal prompt admission
- **AND** a length threshold alone SHALL NOT classify it as ordinary or argument

#### Scenario: A semantic ordinary result does not affect the answer

- **WHEN** the architect returns `ordinary` for a prompt admitted through the
  normal Scribe path
- **THEN** the host SHALL leave the prompt, selected model, primary agent,
  attachments, skill, command, and effort unchanged
- **AND** it SHALL show no reasoning-assist UI, create no AF work, and add no
  pre-send latency compared with assist disabled

#### Scenario: An argument prompt produces a valid map

- **WHEN** the architect returns an argument map within the configured
  validation bounds
- **THEN** the host SHALL validate identifiers, claim classes, dependencies,
  assumptions, evidence needs, and text limits before AF recording
- **AND** it SHALL reject duplicate identifiers, missing dependencies, cycles,
  unsafe values, unsupported claim classes, and limit violations without
  invoking AF

#### Scenario: One exact Markdown fence is normalized before strict parsing

- **WHEN** the architect returns an otherwise valid result inside exactly one
  outer Markdown fence, optionally labeled `json`
- **THEN** the parser SHALL validate the body using the same exact schema and
  bounds as an unfenced JSON result
- **AND** bounded diagnostics SHALL identify that fence normalization occurred
- **AND** prose before or after the JSON, multiple fences, or an over-limit
  original result SHALL remain rejected

#### Scenario: Preflight is unavailable or invalid

- **WHEN** native effective-default-model resolution is null, malformed, or fails, or the
  architect is unavailable, malformed, unsafe, cancelled, stale, or exceeds its
  bounded deadline
- **THEN** the host SHALL expose a bounded unavailable reason where applicable
  and dispatch the unchanged prompt through the normal Scribe path
- **AND** it SHALL not publish a persistent error or `blocked` review result

### Requirement: Inform the normal Scribe response with a bounded assist brief

After a valid argument map exists, the host SHALL construct one size-bounded,
concise brief from validated map facts and, when available, a bounded,
calibrated summary of AF recorded-structure status. The brief SHALL contain no
critic objections, raw AF output, AF ledgers, proof paths, or unsupported claim
that AF establishes truth or proof. It SHALL be delivered only for the current
Scout session and turn through the Scribe-owned V2 plugin's
`session.hook("context")` path, using a host-to-plugin delivery channel proven
by the pre-implementation spike. Once available, the brief SHALL be injected into
every outgoing Scout model call of its matching active turn, beginning with the
first call if it becomes ready within grace or otherwise with the next outgoing
model-loop call after it becomes ready. It SHALL never be injected into a later
turn or another session. Only after a valid map confirms an argument turn may its
first outgoing model call be granted a configured grace period selected from
measured latency and never greater than 2 seconds; the grace wait SHALL happen at
most once for that turn. Ordinary prompt admission and dispatch SHALL NOT wait
for classification; prompt admission itself SHALL not wait for the architect. If
the brief is not ready for the first outgoing model call by that deadline, that
call SHALL proceed without it. V2 context-hook changes SHALL affect only the
outgoing model call, not persisted history or configuration.
The original prompt, selected model, primary agent, files, skill, command,
effort, and normal answer streaming SHALL remain intact.

#### Scenario: A valid brief is available before answer streaming

- **WHEN** a validated argument brief becomes ready for the matching active Scout
  turn by the configured grace deadline for its first outgoing model call
- **THEN** the plugin SHALL add only that bounded brief to every outgoing model
  call of that turn, including subsequent model-loop calls, until the turn is
  cleared
- **AND** it SHALL never add the brief to a later turn or another session
- **AND** it SHALL not modify `session.prompt`, native history, a durable
  instruction entry, or user/project/global configuration

#### Scenario: The brief misses the first-call grace deadline

- **WHEN** no matching brief is ready by the first outgoing model call's
  configured grace deadline
- **THEN** the first call SHALL proceed without the brief
- **AND** when a later valid result becomes available, it SHALL be added to
  every subsequent outgoing model call for the same still-active turn until
  cleared, never a new prompt or session

#### Scenario: A late brief is discarded after the turn completes

- **WHEN** the current turn completes before the architect produces a valid map
  and no further outgoing model call remains in that turn
- **THEN** the host SHALL discard the late result and SHALL NOT mark assist as
  applied
- **AND** it SHALL not synthesize a continuation, extra response, or rewrite

#### Scenario: Optional enrichment is absent

- **WHEN** AF structure recording is unavailable, cancelled, invalid, or times
  out after a valid argument map exists
- **THEN** the host SHALL continue with the validated map brief and normal
  Scribe request
- **AND** it SHALL omit raw AF output from the brief and SHALL NOT claim that AF
  established truth or proof

#### Scenario: The brief is absent from history and a later prompt

- **WHEN** a model call uses an ephemeral brief and the turn completes
- **THEN** native session history and durable instructions SHALL contain no copy
  of that brief
- **AND** the next unrelated user prompt SHALL receive no prior-turn brief

#### Scenario: A brief cannot leak across sessions

- **WHEN** two Scout sessions have pending or completed briefs for distinct
  turns
- **THEN** each outgoing call SHALL receive only its own session/turn-matched
  brief
- **AND** an absent, mismatched, stale, or unknown session/turn key SHALL add
  no brief

#### Scenario: Stop, next prompt, or reconnect clears pending brief state

- **WHEN** the user stops the turn, submits a newer prompt, the turn ends, the
  session changes, or the private server reconnects
- **THEN** the host and plugin SHALL clear or invalidate the previous
  session/turn brief
- **AND** no late hook or delivery SHALL attach it to a later call

#### Scenario: The plugin or delivery channel fails

- **WHEN** plugin hash verification, loading, hook execution, or host-to-plugin
  delivery fails
- **THEN** reasoning assist SHALL become unavailable for the affected turn
- **AND** normal Chat SHALL continue without the brief or an unsandboxed,
  durable-channel, or alternate-server fallback

### Requirement: Show prompt-scoped reasoning-assist activity safely

The webview SHALL render a localized visible activity indicator only for a
prompt confirmed as an argument turn. It SHALL show bounded progress labels and
may display the validated candidate conclusion, material assumptions, evidence
boundary, uncertainty, and AF recorded-structure status to the user. It SHALL
not display raw model reasoning, hidden prompts, child output, graph
identifiers, AF paths or ledger data, tool payloads, or credentials. Ordinary
prompts SHALL have no assist UI, including transient spinners or review cards.

#### Scenario: An argument preflight progresses and succeeds

- **WHEN** the architect validates an argument map and the host prepares its
  brief
- **THEN** the webview SHALL show a localized visible activity indicator with
  bounded progress for assessment, mapping/recording, and answer preparation
- **AND** any retained summary SHALL contain only validated, user-facing map
  facts and bounded calibrated AF recorded-structure status, with no critic
  objections or raw AF output

#### Scenario: An ordinary or failed preflight completes

- **WHEN** the pre-screen or architect returns ordinary, or assistance fails
  before a valid brief exists
- **THEN** the webview SHALL show no assist row, transient spinner, review card,
  or `blocked` state
- **AND** normal answer streaming SHALL remain unchanged

### Requirement: Keep reasoning assistance bounded and host-owned

The architect, brief construction, AF recording, and manual review orchestration
SHALL remain host-owned and SHALL not be exposed through `IAgent`, arbitrary
OpenCode task delegation, MCP, custom tools, Write, the research worker, or the
independent TUI. The sole plugin exception is the bundled Scribe reasoning-context
plugin, which is tool-less, loaded only in Scribe's private V2 server, and used
solely for ephemeral brief delivery through the outgoing context hook. It SHALL
expose no AF executable, path, argv, or invocation route. No other plugin may
expose reasoning or AF authority. The only native reasoning subagent targets
available to Scout are the exact `chat-reasoning-critic` and
`chat-reasoning-verifier` agents under the separate adversarial-review
requirement; neither provides an AF route. If no saved preference exists,
assist SHALL default to enabled when AF is detected and ready; an explicit user
value, including `false`, and the workspace opt-out SHALL be preserved.
Architect, critic, verifier, and review stages SHALL use OpenCode's native
resolved effective default model through its location-bound server API, pinned and
validated against the current connection generation. This honors a configured
OpenCode default without requiring a literal top-level `model` field. No
Scribe-specific model setting, config write, arbitrary first-catalog-model
fallback, or Scribe UI-selected model is permitted. A newer prompt, session
switch/deletion, reconnect, Stop, or cancellation SHALL invalidate stale assist
work and prevent late progress or briefs from affecting another prompt.

For every detached automatic assessment, the host SHALL acquire a fresh
restricted provider bound to the active connection generation, confirm its
readiness, and begin a fresh review lifecycle before creating any hidden
architect session. The assessment SHALL own and cancel only its own review
token and hidden child; it SHALL NOT share or cancel the lifecycle token used by
manual Review argument. The restricted provider's `createSession` token guard
SHALL remain in force. Ordinary completion, failure, timeout, cancellation,
supersession, Stop, or reconnect SHALL invalidate that assessment and clean its
token, hidden session, and hidden-session registration; a late begin/create
completion SHALL not publish or retain a context.

#### Scenario: Begin the automatic review before creating its hidden session

- **WHEN** the automatic architect assessment creates its hidden context
- **THEN** the host SHALL confirm provider readiness and call `beginReview` with
  a fresh generation-bound lifecycle before `createSession`
- **AND** it SHALL create no hidden session if readiness or lifecycle creation
  fails or the connection generation is stale

#### Scenario: Automatic and manual review lifecycles remain isolated

- **WHEN** an automatic assessment begins and cleans up while manual Review
  argument is active on the same host binding
- **THEN** the manual review's token and child SHALL remain current until the
  manual review itself completes or is cancelled
- **AND** automatic cleanup SHALL not cancel or reuse the manual token

#### Scenario: Cancellation or reconnect cleans automatic review ownership

- **WHEN** Stop, cancellation, supersession, or reconnect occurs during review
  begin, hidden-session creation, or architect execution
- **THEN** the host SHALL invalidate only that automatic assessment's lifecycle,
  release its hidden-session registration, and remove any late-created child
- **AND** no stale result, context, or progress SHALL affect the active turn

#### Scenario: A newer prompt supersedes an in-flight assist

- **WHEN** a newer prompt replaces in-flight assist for the same session
- **THEN** the host SHALL cancel the older work before it can publish a brief
- **AND** no late result SHALL affect the newer prompt or its activity indicator

#### Scenario: A generation change invalidates assist readiness

- **WHEN** reconnect, relaunch, sandbox toggle, event recovery, or overlay change
  changes the server generation
- **THEN** the restricted-review holder SHALL rebind and rerun readiness after
  each successful connect, cancel stale work, and republish `reasoningRuntime`
- **AND** no stale-generation holder or result SHALL be used

#### Scenario: Assist is unavailable or opted out

- **WHEN** AF is absent or not ready, native effective-default-model resolution
  is unavailable, the user disables assist, or the workspace opts out
- **THEN** the host SHALL expose a bounded visible unavailable/disabled reason
  where applicable and dispatch normal Chat without assist
- **AND** it SHALL not change global or workspace OpenCode configuration

#### Scenario: A model or extension requests direct access

- **WHEN** a model, tool, plugin, MCP server, Scout, Write, worker, or TUI asks
  to invoke AF or access its raw output, proof workspace, architect, or host review
  provider outside the explicitly approved Scout reviewer targets and typed
  manual-review protocol
- **THEN** no AF/model-visible invocation route or broader authority SHALL
  exist
- **AND** existing host and agent permission boundaries SHALL remain unchanged

### Requirement: Publish bounded preflight outcome diagnostics

The host SHALL publish bounded reasoning outcome diagnostics and numeric
stage-latency timings to the `OpenCode Scribe` LogOutputChannel (Output →
OpenCode Scribe). Records SHALL use fixed stage/reason labels and SHALL NOT
contain prompt text, model output, child text, paths, IDs, credentials,
authorization material, or configuration contents. Repeated and distinct
outcomes SHALL remain within a fixed per-host bound; diagnostics failure SHALL
not block Chat. Parser sub-reasons, malformed structural shapes, and applied
fence normalization SHALL use fixed enum labels only. For a
`missing-dependency` parse failure, diagnostics SHALL also report one fixed
sub-reason selected in this order: `dependency-unknown-conclusion`,
`dependency-target-assumption`, `dependency-unknown-target`,
`dependency-unknown-assumption-claim`, `dependency-unknown-evidence-claim`,
`dependency-unreachable-claim`, then `dependency-other`.

#### Scenario: A failed preflight is self-explaining

- **WHEN** pre-screen, architect, AF recording, brief delivery, or review work
  completes, fails, or reaches a deadline
- **THEN** the output channel SHALL receive only a bounded classification,
  fixed stage/reason labels, and numeric elapsed time
- **AND** it SHALL receive no prompt, result, child output, path, identifier,
  credential, or configuration value

#### Scenario: Dependency failures include only a fixed sub-reason

- **WHEN** an architect result is rejected with `missing-dependency`
- **THEN** the parse diagnostic SHALL include exactly one allow-listed
  dependency sub-reason from the specified first-match order
- **AND** it SHALL contain no claim identifier or statement

#### Scenario: Diagnostics stay bounded

- **WHEN** many prompts produce repeated or distinct reasoning outcomes
- **THEN** the host SHALL enforce its fixed per-instance diagnostic bound
- **AND** diagnostic sink errors SHALL not change prompt admission or answer
  delivery

#### Scenario: A blank completed Thought is hidden but active loading remains visible

- **WHEN** a reasoning segment is complete with empty text, or is active with empty text
- **THEN** the completed empty Thought SHALL not be shown
- **AND** the active empty segment SHALL remain visible as loading
- **AND** no requirement is implied that reasoning content exists
