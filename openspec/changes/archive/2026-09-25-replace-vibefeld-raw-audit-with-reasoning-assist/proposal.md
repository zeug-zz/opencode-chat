# Proposal: Replace Vibefeld Raw Audit With Reasoning Assist

## Why

The current reasoning-review flow sends ordinary completed Scribe prose to a
private claim-graph grammar. Normal answers do not use that grammar, so review
usually produces `blocked` rather than useful structure. Scribe needs a small,
automatic way to prepare argument-heavy answers from ordinary user prompts
without asking users to author AF syntax or turning normal chat into a visible
multi-agent workflow.

## What Changes

- Replace arbitrary completed-response `Review argument` parsing with a bounded
  prompt preflight that classifies the request as ordinary or argument-heavy.
- Retire the completed-message review affordance, the raw-prose source-packet
  route used by the manual and automatic post-response paths, and automatic
  routing and qualification capture, rather than reusing that pipeline.
- For a valid argument preflight, create and locally validate a compact claim
  graph, optionally record its bounded structure through the existing AF bridge,
  and obtain at most one hidden independent critic result.
- Add a bounded, host-built reasoning brief to the normal Scribe request before
  its answer streams. The original user prompt and normal streaming behavior
  remain unchanged.
- Replace persistent post-response `blocked` cards with prompt-scoped,
  user-visible progress and an expandable compact argument summary only when a
  valid brief exists.
- Narrow the existing prover/verifier review workflow for this path to one
  hidden critic stage. Verifier stages, post-response alignment checks,
  revisions, AF challenge relations, and notebooks are not part of this change.

## Capabilities

### New Capabilities

- `vibefeld-reasoning-assist`: Automatically prepare a bounded argument brief,
  show safe progress, and pass the brief to the normal Scribe response.

### Modified Capabilities

- `vibefeld-reasoning-review`: Retire the completed-message raw-prose review
  action and card in favor of prompt-scoped reasoning-assist presentation.
- `vibefeld-claim-projection`: Accept only a locally validated architect graph
  for this path and describe current AF output as recorded structure rather than
  logical validation.
- `vibefeld-adversarial-review`: Permit one host-owned hidden critic during a
  valid prompt preflight rather than only a manual post-response
  prover/verifier review.
- `vibefeld-restricted-contexts`: Permit the existing restricted boundary to
  run bounded architect and critic stages while preserving its host ownership,
  exact deny map, hidden-session lifecycle, and model pinning.
- `vibefeld-automatic-routing`: Retire post-response automatic selection,
  corpus qualification, and routing rationale with the raw-prose review route.
- `vibefeld-activation`: Retire the completed-message review affordance,
  qualified routing, and qualification-capture wiring with the raw-prose route.

## Impact

- Affected host code: `ChatViewProvider` prompt dispatch, Vibefeld controllers,
  claim-graph validation, AF projection mapping, hidden restricted-review
  orchestration, and removal of the post-response review, automatic-routing, and
  qualification wiring.
- Affected shared and webview code: typed prompt-scoped assist events, state,
  localized progress, and compact argument-summary rendering.
- Affected agent adapter: the existing host-owned restricted provider gains the
  narrowly defined architect and critic stage contracts; it does not become a
  model-visible tool or change `IAgent`.
- Existing ordinary Chat, Write, Scout, research, sandbox, MCP, memory, TUI,
  attachment, and answer-streaming behavior remains compatible when assistance
  is unavailable or a prompt is ordinary.

## Non-Goals

- Proving a claim, verifying sources, or exposing private reasoning
- A general AF tool, plugin, MCP server, or model-visible command path
- Response gating, automatic post-response re-auditing, or rewrite loops
- A verifier stage, multi-round debate, cross-session notebook, or argument
  retention
