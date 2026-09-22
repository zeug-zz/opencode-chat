## Context

The current host sends prompts through the OpenCode agent and the agent invokes
`promptAsync`/the direct send path while events stream to the webview. The
existing reasoning-review card and adversarial-review controller operate on a
completed, already published assistant message. Neither can withhold a response.
Therefore this design does not retrofit gating onto a post-stream hook or claim
that prompt wording or ordinary task delegation supplies a transaction.

The change adds a host-owned transactional boundary that is dormant unless a
typed, capability-gated insertion point is available. A future implementation
may place it around a host-owned completed-response publication callback, or
provide an equivalent typed adapter that proves draft creation precedes release
and that the host owns the release operation. Until that proof exists, the
configured capability is incompatible and normal behavior stays unchanged.

## Goals / Non-Goals

**Goals:**

- Define a precise draft/review/release state machine with ownership,
  single-use tokens, isolation, cancellation, timeout, and audit semantics.
- Keep response-gate types and orchestration private to the VS Code platform
  Vibefeld modules unless a provider-neutral contract is demonstrably required.
- Reuse bounded source-packet, claim projection, adversarial-review, and
  reasoning-review summary semantics without adding a truth/proof status.
- Prove with an injected fixture that a draft is withheld and released once only
  after a valid calibrated review.
- Preserve ordinary behavior when the gate is absent, unavailable, or
  incompatible, and keep activation dormant rather than wiring a fixture.

**Non-Goals:**

- Making the existing streaming `promptAsync` path appear transactional without
  an actual host insertion point.
- Adding child agents, broader permissions, AF execution, process/shell/network
  access, automatic routing, general mandatory gating, or a persisted store.
- Rewriting `IAgent`, the core protocol, OpenCode overlays, sandbox policy,
  nono profiles, global config, proof roots, or independent TUI behavior.

## Decisions

### Use a host-owned transactional insertion point, not a post-stream hook

The private seam MUST expose a host-controlled operation equivalent to
`beginDraft`, `submitReviewDecision`, `release`, and `cancel`, with publication
owned by the gate while a transaction is pending. The adapter MUST report
whether this insertion point is actually available and compatible. A seam that
observes an already streamed response is incompatible and MUST NOT report an
eligible gate. The current direct `promptAsync`/send path therefore remains
ungated until a real publication boundary is established.

The implementation SHOULD use an immutable candidate response and a bounded
publication callback rather than copying or mutating OpenCode message parts.
The callback MUST be invoked only by the host after the gate validates the
transaction and decision.

### Model a single-owner state machine

Each transaction is identified by a random opaque single-use token and is bound
to one active session, one assistant message identity, and one gate owner. The
states are:

`draft` → `reviewing` → `approved` → `released`

or, from any pre-release state, `cancelled`, `timed_out`, `failed`, or
`audit_failed`. Only `approved` may transition to `released`; release consumes
the token and is exactly once. A token, session/message key, owner, or state
mismatch is stale and cannot change state. Terminal states cannot be reused.

Draft creation MUST retain only an immutable bounded response candidate and
bounded source packet. Review MUST hand off through the existing adversarial
review and reasoning-review summary semantics, with no raw prompt, private
reasoning, source packet, child payload, path, command, ledger, credential, or
unsafe diagnostic crossing the boundary.

### Calibrate decisions and fail closed

Only a valid, complete, provenance-safe, non-ambiguous adversarial-review
outcome can produce `approved`. A confirmed or unresolved objection, evidence
conflict, malformed result, timeout, cancellation, cleanup error, stale result,
or audit failure MUST prevent release. A decision MUST preserve existing
evidence status and interpretive boundaries; adversarial agreement MUST NOT
become `structurally_checked`, `refuted`, a truth claim, or formal proof.

The host SHOULD map an ineligible or unavailable gate to the existing bounded
unavailable/manual semantics, with no claim that delivery was gated. An
eligible configured gate MUST never silently bypass review, retry through a
broader authority, or release on ambiguity.

### Keep opt-in and activation dormant

Eligibility MUST require explicit user opt-in and a validated capability for the
specific response class. Automatic selection/routing and general mandatory
gating remain out of scope. The default extension activation MUST NOT construct
or wire an unavailable/fixture adapter into normal Chat or Write. A future live
adapter must be injected only after its authority, lifecycle, and insertion
point have been reviewed.

### Use fixture-only proof of the lifecycle

The deterministic fixture SHOULD implement the seam entirely in memory with a
test publication callback. It MUST demonstrate: draft withheld; valid
calibrated review; one release; second release rejected; and no release for
invalid, stale, cancelled, timed-out, ambiguous, or audit-failed decisions.
The fixture MUST require no AF binary, child service, network, shell, user
profile, active workspace proof root, absolute `/tmp`, or configuration write.

## Compatibility, Migration, and Rollback

No persisted-data or protocol migration is required. Existing direct streaming
remains the fallback when the gate capability is absent or incompatible. The
change is additive and can be rolled back by removing the private modules and
fixture tests; no shared API, agent overlay, configuration, permission, or
workspace behavior needs migration.

## Risks / Trade-offs

- A false gate claim is worse than no gate: require proof of the publication
  boundary and suppress the claim when unavailable.
- Holding a response may complicate cancellation: use host-owned token
  invalidation, bounded timers, and terminal cleanup before publication.
- More shared types could leak Vibefeld details: keep all types private unless
  an unavoidable provider-neutral contract is demonstrated and separately
  justified.
- A fixture could be mistaken for production support: keep it test-only, assert
  it is not imported by activation, and report fixture capability separately.

## Open Questions

None. If the current OpenCode event path cannot provide the required insertion
point, the compatible result is unavailable and the normal path remains
ungated; this is a deliberate acceptance condition, not an implementation gap.
