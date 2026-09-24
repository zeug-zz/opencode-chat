# Design

## Context

See [proposal.md](proposal.md) for the motivation and the delta specs for the
behavior contract.

Today `ChatViewProvider.dispatchPrompt()` calls the normal
`IAgent.sendMessage()` path directly. That path already accepts a host-built
`system` instruction while preserving the original prompt, selected model,
primary agent, files, skill, command, and effort. This is the correct insertion
point for a compact preflight brief before normal answer streaming.

The current review path is post-response: a manual completed-message request and
an automatic-routing selection both derive a source packet from completed visible
assistant text and pass that text to `compileClaimGraph()`, whose input is a
private line grammar. The new path must not reuse that source-packet boundary.

The repository already has a host-owned AF bridge with fixed operations and a
restricted child-session provider with an exact deny overlay, generation-bound
readiness, hidden-session registry, bounded retrieval, cancellation, and
disposal. Both are reusable after their contracts are narrowed for prompt
preparation. The current AF claim bridge records a root and child statements;
it does not establish the graph dependency or challenge relations.

## Goals / Non-Goals

**Goals:**

- Run one small automatic preflight before eligible normal Scribe prompts.
- Use a schema-valid argument map as the sole production input to claim-graph
  validation.
- Give normal Scribe a compact, host-built brief before it streams an answer.
- Show safe, concise progress and resulting argument artifacts when they exist.
- Reuse existing AF and hidden-child safety boundaries without making them
  model-visible.

**Non-Goals:**

- A hidden chain-of-thought or child-output transcript
- A response gate, post-response auto-review, answer rewrite, or revision loop
- A verifier, formal proof engine, source verifier, AF relation/challenge verb,
  notebook, or retained argument workspace
- Changes to `IAgent`, Chat/Write/Scout permissions, MCP, plugins, sandbox
  policy, the independent TUI, or OpenCode configuration files

## Decisions

### 1. Use one architect preflight as both classifier and graph producer

The host sends one bounded packet to a restricted `architect` stage. Its exact
JSON result is either `{ "kind": "ordinary" }` or a bounded argument-map
object. A separate heuristic classifier would create a second decision path,
misclassification behavior, and UI state without improving the graph that
Scribe needs. Asking the main Scribe request to decide after it begins streaming
is too late to inform that request.

The packet includes only the new user text, a short same-session context window,
and an earlier compact assist summary for the same active thread. It excludes
attachments and raw tool results. This prevents preflight from becoming a second
unbounded chat session or a way to bypass normal file and research rules.

The architect output parser is exact-key and fail-closed. It applies the same
bounded text, ID, node, edge, depth, claim-class, safe-text, and acyclic-graph
checks used by the existing private graph domain. It does not repair malformed
model output. A failure means no assist, not a blocked user request.

**Alternative considered:** Parse the final assistant response. This is the
current path and requires Scribe or the user to emit private protocol syntax; it
is the direct cause of ubiquitous `blocked` results.

### 2. Keep AF optional and describe it only as recorded structure

After local graph validation, the host may start the existing contracted AF
recording sequence. It uses only fixed host-owned operations and does not pass a
raw user prompt or model-controlled argv. The main brief records one optional
fact, `AF structure recorded`, only after expected recording facts return.

The brief never says `structurally checked`, `logically valid`, or `proved` for
the current AF sequence. That sequence is useful as a bounded argument ledger,

**Alternative considered:** Wait for an unobserved AF challenge/dependency API.
That would defer a usable structured-writing feature. Relation support remains a
capture-first follow-up and is not inferred from documentation or an arbitrary
CLI verb.

### 3. Use one optional critic, not a prover/verifier debate

Once the architect map validates, the host may run one restricted `critic`
stage. It receives only the validated graph and returns at most two objections
targeting a known claim or assumption. The host validates and redacts the result
before incorporating it into the brief.

AF recording and the critic run concurrently after validation. Either can fail
without invalidating the architect map. The prompt starts normal Scribe dispatch
when both settle or the bounded preflight deadline expires. The host cancels
unfinished optional work at that deadline.

A verifier is intentionally omitted. The main Scribe request treats objections
as issues to address or qualify, never accepted facts. This gives the author an
independent countercase at one additional bounded stage rather than paying for
two child contexts and adjudication infrastructure.

**Alternative considered:** Reuse the existing prover/verifier orchestration.
It solves a stronger, manual post-response problem, introduces another model
round-trip, and conflicts with the desired low-latency preflight.

### 4. Publish a dedicated assist lifecycle, not synthetic model reasoning

Core receives a provider-neutral `ReasoningAssistProgress` contract keyed by
session and a host-generated prompt token. Its stages are:

```ts
type ReasoningAssistStage =
  | "assessing"
  | "mapping"
  | "recording"
  | "critiquing"
  | "preparing"
  | "applied";
```

The final event may contain a compact summary with display-safe conclusion,
assumptions, evidence/uncertainty boundary, bounded objections, and the AF fact.
It contains no provider ID, graph ID, raw packet, model output, session title,
path, command, or workspace data.

The webview renders this as an expandable `Reasoning assist` row attached to the
pending user prompt and, after completion, to the response it informed. It is
not a `ReasoningPart`, does not use the `Thought` component, and does not mimic
or expose model chain-of-thought. No valid brief means no retained row.

**Alternative considered:** Stream the architect and critic text in the existing
thinking block. Those texts are untrusted hidden-stage output and cannot safely
be presented as Scribe reasoning; progress plus validated artifacts provides the
required transparency without disclosure.

### 5. Compose the brief at the host boundary

The prompt dispatcher owns an in-flight assist record before it invokes the
normal agent. It publishes `assessing`, invokes the preflight, and either:

- dispatches the unchanged prompt for `ordinary` or failed preflight, or
- builds one bounded system-string addition from validated facts and dispatches
  the original prompt with that addition.

The normal primary request remains the only user-visible Scribe session. The
brief is not added as a user message or a durable session message part.

The host combines an existing system prompt and assist addition with a fixed
delimiter, preserving present primary-agent and caller system-instruction
behavior. It must impose a total length bound and omit optional values rather
than truncating a claim or objection into a misleading statement.

**Alternative considered:** Send a second user message after preflight. It would
alter session history and make the internal brief visible to normal model/tool
context in a way the feature does not need.

### 6. Reuse restricted lifecycle mechanics while adding only two stage names

The agent package generalizes the private stage-role union from
`prover | verifier` to `architect | critic` for this path. The in-memory overlay
remains one hidden restricted agent with the existing explicit deny map, pinned
model, fixed host prompt, bounded steps, and configuration-readiness proof. The
host provides fixed stage-specific system instructions and exact output parsers.

The hidden-session registry, marker titles, generation checks, registration
race handling, cancellation, deletion, startup scavenging, and deactivation
cleanup are retained. Architect raw text is retained only long enough to parse
the map; critic raw text is retained only long enough to normalize its bounded
objections. Neither raw result crosses into core or webview state.

**Alternative considered:** Expose an AF or critic tool directly to Scribe. That
would broaden model authority and violate the existing host-owned security
boundary.

## Flow

```text
webview sendMessage
  -> prompt queue activates prompt token
  -> host publishes assessing
  -> restricted architect receives bounded packet
  -> ordinary: remove pending assist, normal dispatch
  -> valid graph:
       host publishes mapping
       AF recording + restricted critic run concurrently
       host validates settled facts or cancels at deadline
       host publishes preparing with compact summary
       host appends brief to normal system instruction
       normal Scribe request streams
       host publishes applied summary
```

The queue's active state covers the preflight and normal request. A prompt
failure before normal dispatch retains the current queue retry behavior. A
normal-request failure after preflight preserves that behavior without retaining
an applied summary.

## Module Boundaries

- `packages/core/`: provider-neutral assist types and UI-to-host/host-to-UI
  protocol messages only.
- `packages/agents/opencode/`: fixed restricted-stage role/instruction support,
  exact output transport, host-pinned model, and child lifecycle only.
- `packages/platforms/vscode/src/vibefeld/`: private architect parser, graph
  conversion, critic normalization, AF recording adapter, assist orchestrator,
  and stale-result guards.
- `packages/platforms/vscode/src/chat-view-provider.ts`: eligibility decision,
  prompt lifecycle, progress publication, brief composition, and normal dispatch
  integration.
- `packages/platforms/vscode/webview/`: assist state, prompt-linked component,
  and localized display strings only.

The VS Code platform package continues to access the OpenCode SDK only through
the agent package. No new `IAgent` method is introduced.

## Cancellation and Ordering

Each preflight receives a host-generated token and records the current extension
generation and prompt queue generation. Before publishing progress, adding a
brief, or retaining a summary, the host verifies all three are still current.

A superseding prompt, cancellation, session change, deletion, reconnect, or
deactivation invalidates the token. The host cancels AF work and child contexts,
awaits hidden-session disposal where existing lifecycle rules require it, and
drops late results. A stale preflight never reaches `sendMessage()` and cannot
add its brief to another prompt.

## Risks / Trade-offs

- [Preflight adds latency for argument prompts] -> One architect call is both
  classifier and mapper; AF and critic run only after a valid graph and in
  parallel; ordinary/failed cases dispatch unchanged.
- [Architect output can be malformed or overbroad] -> Exact parser and local
  graph validation discard it and preserve normal Scribe dispatch.
- [Critic output can overstate an objection] -> Limit it to two validated
  objections and instruct the main Scribe to address or qualify them, not accept
  them as facts.
- [Current AF output is weaker than the product name implies] -> Display only
  `AF structure recorded`; relation and challenge semantics remain out of scope.

## Migration Plan

This is a source and UI behavior replacement with no user-data migration. The
implementation removes the completed-message review affordance, the raw-prose
source-packet route used by both the manual request and the automatic-routing
post-response path, automatic routing, and qualification capture in the same
change that enables the new prompt-scoped row.

If the preflight is unavailable at runtime, the host falls back per prompt to
the unchanged normal Scribe request, rather than restoring the unusable manual
`blocked` workflow. A code rollback restores the prior release atomically; no
persisted graph, qualification aggregate, notebook, setting, workspace, or
configuration needs cleanup.
