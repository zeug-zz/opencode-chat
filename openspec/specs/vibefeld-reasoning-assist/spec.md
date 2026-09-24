# vibefeld-reasoning-assist Specification

## Purpose
Provide Scribe with a bounded automatic argument-preparation path that improves
argument-heavy responses without requiring AF syntax, exposing private reasoning,
or delaying ordinary conversation behind an unavailable review workflow.

## Requirements

### Requirement: Classify and map eligible prompts before normal dispatch

For an eligible Scribe text prompt, the host SHALL run one bounded, host-owned
preflight that returns either `ordinary` or a schema-valid argument map. The
preflight input SHALL contain only the new user text, a bounded same-session
context window, and an existing compact same-thread assist summary when present.
It SHALL not receive attachments, tool content, private reasoning, host paths,
credentials, AF output, or unrestricted session history. A valid argument map
SHALL contain a bounded candidate conclusion, typed claims, assumptions,
dependencies, evidence needs, and uncertainty boundaries. The host SHALL
validate the map before any AF or critic work.

#### Scenario: An ordinary prompt receives normal dispatch
- **WHEN** an eligible prompt's preflight returns `ordinary`
- **THEN** the host SHALL dispatch the unchanged prompt through the normal
  Scribe path
- **AND** it SHALL not create AF work, a critic context, or a retained
  reasoning-assist summary

#### Scenario: An argument prompt produces a valid map
- **WHEN** an eligible prompt's preflight returns a map within the configured
  validation bounds
- **THEN** the host SHALL validate its identifiers, claim classes, dependencies,
  assumptions, evidence needs, and text limits before continuing
- **AND** it SHALL reject duplicate identifiers, missing dependencies, cycles,
  unsafe values, unsupported claim classes, and limit violations without
  invoking AF or the critic

#### Scenario: Preflight is unavailable or invalid
- **WHEN** the preflight is unavailable, malformed, unsafe, cancelled, stale, or
  exceeds its bounded deadline
- **THEN** the host SHALL dispatch the unchanged prompt through the normal Scribe
  path
- **AND** it SHALL not publish a persistent error or `blocked` review result

### Requirement: Inform the normal Scribe response with a bounded assist brief

After a valid argument map exists, the host SHALL construct one bounded brief
from validated map facts and any completed optional enrichment facts. The host
SHALL append that brief only through the host-owned system instruction of the
normal Scribe request. The original user prompt, selected model, primary agent,
files, skill, command, effort, and normal answer streaming SHALL remain intact.
The brief SHALL describe AF only as recorded structure and SHALL not claim that
a premise, source, empirical proposition, normative conclusion, or argument is
true, proved, or formally verified.

#### Scenario: A valid brief is available before answer streaming
- **WHEN** a valid argument map is available and optional enrichment has settled
  within its bounded preflight budget
- **THEN** the host SHALL include the compact conclusion, assumptions, evidence
  boundary, uncertainty, and valid critic objections in the normal Scribe
  system instruction
- **AND** the normal Scribe response SHALL stream after preflight rather than be
  generated, withheld, and released later

#### Scenario: Optional enrichment is absent
- **WHEN** AF recording or the critic is unavailable, cancelled, invalid, or
  times out after a valid argument map exists
- **THEN** the host SHALL omit only the unavailable enrichment fact from the
  brief
- **AND** it SHALL continue the normal Scribe request with the validated map

### Requirement: Show prompt-scoped reasoning-assist activity safely

The webview SHALL render a localized prompt-scoped reasoning-assist row only
while an eligible preflight is in progress or after it produces a valid brief.
The row SHALL show bounded progress labels and may expand to show the candidate
conclusion, material assumptions, evidence boundary, uncertainty, bounded critic
objections, and an AF recorded-structure fact. It SHALL not render raw model
reasoning, hidden prompts, child output, graph identifiers, AF paths or ledger
data, tool payloads, or credentials.

#### Scenario: An argument preflight progresses and succeeds
- **WHEN** an argument preflight maps the prompt and prepares its brief
- **THEN** the webview SHALL show ordered localized progress for assessment,
  mapping, optional structure recording or critique, and answer preparation
- **AND** it SHALL retain only the compact summary associated with the prompt
  and resulting response

#### Scenario: An ordinary or failed preflight completes
- **WHEN** the preflight returns `ordinary` or fails before a valid brief exists
- **THEN** the webview SHALL remove its pending activity row
- **AND** it SHALL not show a review card, persistent spinner, or `blocked`
  state

### Requirement: Keep reasoning assistance bounded and host-owned

The preflight, AF recording, and critic SHALL be initiated only by the host for
eligible Scribe prompts. They SHALL not be exposed through `IAgent`, ordinary
model prompts, OpenCode task delegation, plugins, MCP, custom tools, Scout,
Write, the research worker, or the independent TUI. A newer prompt, session
switch, session deletion, reconnect, or cancellation SHALL invalidate stale
assist work, cancel its child contexts and AF operation when applicable, and
prevent late progress or briefs from affecting another prompt.

#### Scenario: A newer prompt supersedes an in-flight assist
- **WHEN** a newer prompt replaces an in-flight preflight for the same session
- **THEN** the host SHALL cancel and clean up the older assist work before it can
  publish a brief
- **AND** no late result from the older work SHALL be appended to the newer
  prompt or rendered in its reasoning-assist row

#### Scenario: A model or extension requests direct access
- **WHEN** a model, tool, plugin, MCP server, Scout, Write, worker, or TUI asks
  to invoke the architect, critic, AF, or a preflight workspace directly
- **THEN** no model-visible or agent-visible invocation route SHALL exist
- **AND** the existing authority boundaries SHALL remain unchanged

### Requirement: Publish bounded preflight outcome diagnostics

The host SHALL make each preflight outcome distinguishable in bounded host
diagnostics: the outcome reason SHALL identify eligibility, stage unavailability,
stage failure, an ordinary result, an invalid stage result, or a deadline, and an
invalid stage result SHALL additionally expose only the numeric stage text length
and the bounded schema-validation sub-reason, and a timed-out stage or expired
preflight SHALL additionally expose only the numeric elapsed stage time.
Diagnostics SHALL name no raw stage text, packet content, graph identifiers, or
failure payload, and SHALL be emitted at most once per distinct reason per host
instance up to a fixed bound.

#### Scenario: A failed preflight is self-explaining
- **WHEN** a preflight ends without a valid argument map
- **THEN** the host SHALL record one bounded diagnostic naming the outcome reason,
  the bounded schema-validation sub-reason, and the numeric stage text length for
  an invalid stage result
- **AND** it SHALL NOT log stage text, packets, or model-controlled content

#### Scenario: Diagnostics stay bounded
- **WHEN** many prompts produce the same or many distinct outcome reasons
- **THEN** diagnostics SHALL be emitted at most once per distinct reason per
  host instance within the fixed bound
