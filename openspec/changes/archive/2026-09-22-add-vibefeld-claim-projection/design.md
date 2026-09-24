## Context

See `proposal.md` for the motivation and scope. The preceding runtime-contract and
runtime-bridge artifacts establish the relevant boundary: AF evidence is private,
the bridge is host-owned and separately sandboxed, and the current bridge operation
union is exactly `version`, `schema`, `init`, and `status`.

The current bridge's normalized successful results retain `structuralStatus: null`.
Its `status` facts describe the observed AF workspace state, not a claim review. No
claim, node mutation, challenge, or evidence operation is currently observed or
approved. The existing review path is already post-response and manual: the host
checks the active completed assistant message, extracts at most the visible text
source packet, calls `IReasoningReviewController`, and publishes a
`ReasoningReviewSummary` through the existing protocol and webview card. The host
already rejects stale session/message results and cancels work when the session
changes or is deleted.

## Goals / Non-Goals

**Goals:**

- Validate and compile a small private claim graph from the existing visible source
  packet without a model, network, plugin, MCP server, or arbitrary process.
- Preserve separate logical/evidence dimensions and map them to bounded,
  calibrated provider-neutral summary fields.
- Make AF claim projection capability-gated by an explicit private seam, with no
  inferred capability from compatibility, initialization, or status success.
- Reuse the existing manual controller injection, typed request/result protocol,
  webview card, host cancellation, and stale-result protections.
- Keep normal activation dormant and make default verification fixture-only.

**Non-Goals:**

- Adding an AF claim operation to the current bridge or treating `status` as one.
- Implementing adversarial child models, restricted prover/verifier contexts,
  automatic routing, response release gating, or pre-response review.
- Publishing raw source text, claim-node identifiers, AF paths, commands, flags,
  ledgers, prompts, child output, or model reasoning through the shared summary.
- Changing `packages/core` or the webview protocol unless an independently proven
  provider-neutral field is absolutely required; the planned design needs neither.
- Changing OpenCode, AF, nono, workspace, profile, plugin, MCP, Scout, Write,
  worker, Chat sandbox, or independent TUI configuration.

## Decisions

### Keep claim projection platform-private and reuse the existing review route

Claim graph, evidence, AF capability, and bridge-result types remain under
`packages/platforms/vscode/src/vibefeld/`. The controller continues to implement
the existing `IReasoningReviewController`; `ChatViewProvider` continues to own
active-session validation, authoritative message retrieval, bounded source-packet
construction, cancellation, and stale-result filtering. The existing
`ReasoningReviewSummary` is sufficient for publication, so no new core protocol
discriminant or model-facing API is planned.

**Alternative rejected:** putting AF claim types in `packages/core` or adding AF
operations to `IAgent`. That would leak provider details across the shared boundary
and make a host-only, manual capability available to ordinary agent paths.

### Compile conservatively from the existing visible source packet

The compiler receives only the already bounded visible assistant text. It produces a
host-private graph with a bounded root conclusion, explicit claim nodes, typed claim
classes (`deductive`, `computational`, `empirical`, `procedural`, `interpretive`, or
`normative`), material assumptions, logical dependency edges, and evidence
references. The compiler is deterministic and local; it does not ask a child model
to invent claims or invoke a tool. It must reject or return a bounded non-success
when the source cannot be represented within configured limits instead of silently
dropping material dependencies.

Validation occurs before any projection attempt and enforces unique bounded IDs,
required root/conclusion data, allowed claim classes, valid dependency references,
acyclic logical dependencies, separate evidence references, maximum node/depth/
text/edge counts, and no paths, commands, prompts, credentials, raw ledger data, or
private reasoning. The compiled graph is never sent through the webview protocol.

**Alternative rejected:** sending the raw source packet to AF or using prompt text
to request an unconstrained graph. Both approaches would make parser safety,
injection resistance, and boundedness dependent on an external model or runtime.

### Represent evidence as metadata, not proof content

Each graph claim records evidence dependencies separately from logical dependencies.
Evidence metadata may identify only bounded source categories and states such as
`not_required`, `source_recorded`, `unverified`, `human_verified`, or `conflicted`;
it does not retain source excerpts, URLs, credentials, tool output, or hidden
instructions. Contradictory evidence is represented as `conflicted` and cannot be
collapsed into a positive structural result.

The mapper applies an explicit calibration table:

- A valid graph with no supported AF claim capability returns `unavailable` with a
  bounded explanation that no structural review was performed.
- Graph validation failure returns `blocked` or `unresolved` with no structural
  claim and no evidence upgrade; the exact bounded reason is selected without
  echoing invalid input.
- Missing, malformed, timed-out, cancelled, signaled, policy, cleanup, or audit
  bridge results map to `unavailable` or `audit_failed` as supplied by the private
  bridge classification, never to `structurally_checked`.
- An explicit AF `structurally_checked` result is publishable only when the claim
  graph was valid and evidence is `not_required` or `human_verified`.
- A structural result paired with `source_recorded` or `unverified` evidence maps
  at most to `conditional`; conflicting evidence maps at most to `unresolved`.
- Explicit AF `conditional`, `unresolved`, or `refuted` results remain calibrated
  statuses, with an interpretive boundary that they describe recorded structure,
  not external truth. An AF result cannot upgrade evidence status.

**Alternative rejected:** one combined `reviewed` or `passed` flag. It would hide
the distinction between logical structure and whether sources or premises have
been checked.

### Require an explicit claim-capability seam

The projection controller depends on a narrow private capability seam that can
report whether a supported claim operation exists and, only when it does, accept a
validated compiled graph plus cancellation. The seam returns normalized structural
facts and bounded failure classes, never raw AF output or paths. The current
`VibefeldRuntimeBridge` does not implement that seam: its only allowed operations
remain `version`, `schema`, `init`, and `status`, and its results retain
`structuralStatus: null`.

The production controller therefore uses a no-capability implementation or lazy
bridge factory until a later predecessor bridge revision supplies an observed,
approved, fixture-derived claim operation. A fixture/private adapter may exercise
the mapper in default tests only when the fixture explicitly declares the claim
capability; it must not be wired into activation or presented as AF compatibility.
No claim operation, output shape, exit mapping, or fixture fact is invented in this
change.

**Alternative rejected:** interpreting a successful `status` or `init` operation as
claim projection. Those operations establish compatibility/workspace facts only,
and the current bridge explicitly prevents structural status publication.

### Keep the phase lazy, manual, and post-response

The existing controller injection point remains the lifecycle boundary. Controller
construction is side-effect free; ordinary activation does not preflight AF,
allocate a proof root, or create a claim graph. On an explicit review request, the
controller validates the source-derived graph, checks the private capability, and
performs only the supported projection. If capability or runtime is absent, it
returns a bounded unavailable summary through the existing route.

Existing host request tokens remain authoritative. Cancellation aborts the private
projection seam, removes the in-flight key, and prevents publication. Session
switch, deletion, invalid message, and stale controller results are ignored using
the existing `ChatViewProvider` behavior. The original assistant response is never
delayed, rewritten, gated, or mutated.

### Use fixture-only verification by default

Default tests use sanitized checked-in AF compatibility fixtures, deterministic graph
inputs, and injected private capability seams. They verify the current no-claim
operation outcome, mapping of explicit fixture results, evidence conflicts, bounded
errors, cancellation, stale state, and source/configuration security negatives.
They do not resolve or spawn AF, access a user profile, use the active workspace as
proof storage, or make network requests. Any live claim-operation test is deferred
to the predecessor bridge's explicit disposable-runtime and policy gates.

## Risks / Trade-offs

- [A deterministic compiler may be conservative for dense or ambiguous prose] ->
  Reject or return a bounded non-structural result rather than infer hidden claims;
  keep the graph limits and failure reason visible only as safe summary metadata.
- [A valid graph may be mistaken for a validated argument] -> Keep graph validity,
  AF structural status, and evidence status separate; prohibit structural success
  when evidence is merely recorded, unverified, or conflicted.
- [The predecessor bridge may remain claim-incomplete] -> Treat the private seam as
  unsupported, publish unavailable/non-structural output, and retain
  `structuralStatus: null`; do not add a guessed AF verb.
- [Source text could contain prompt injection or sensitive content] -> Treat it as
  untrusted data, apply bounded local validation, keep it out of instructions and
  summaries, and reject unsafe graph values without echoing them.
- [A late result could appear in another session] -> Reuse the host's message and
  session token checks and cancellation invalidation before publishing.
- [A fixture-only seam could be mistaken for production support] -> Mark it
  test-only, require an explicit capability declaration, and add dormant/security
  negatives for activation, agent, protocol, plugin, MCP, and sandbox boundaries.

## Migration Plan

There is no persisted-data, workspace, configuration, profile, or protocol
migration. The change is additive to the existing manual review path. Rollback is
removing the private claim compiler, mapper, seam, controller wiring, and tests;
the existing unavailable controller and ordinary Chat behavior remain the safe
fallback. A later bridge change must separately add and validate any claim
operation before this phase may publish an AF-backed structural status.

## Open Questions

None. Whether a future bridge supports a claim operation is an explicit capability
input and does not change this phase's safe no-capability behavior.
