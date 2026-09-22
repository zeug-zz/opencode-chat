## Context

See `proposal.md` and the records in `plans/vibefeld-scribe.md` (Activation
Path addendum and the 2026-09-22 Review Availability Correction). The
predecessor changes contract a dormant pipeline: a fixed `version`/`schema`/
`init`/`status` bridge with `structuralStatus: null`, a capability-gated claim
seam that is hard-coded unsupported, and an activation gate that publishes
`claim-capability-unavailable` whenever the seam is unsupported.

The real AF 0.1.11 CLI was observed during planning:

- `af claim <node-id> --owner <owner> --role prover|verifier --format json`
  returns `{ context, expires_at, node_id, owner, role, status, timeout }`,
  where `context` embeds node/statement/dependency prose.
- `af refine <parent-id> <statement>... --owner <owner> --format json` returns
  `{ children: [{ id, type, statement, inference }], parent_id, success }`.
- `af status --dir <workspace> --format json` is already contracted.
- A parent must be claimed before it can be refined; a second `init` or a
  second `claim` of an already-claimed node fails non-zero; a claimed parent can
  be refined repeatedly while the claim is held.

## Goals / Non-Goals

**Goals:**

- Contract only the observed `claim`/`refine` shapes as sanitized fixtures,
  strict parsers, and bounded typed operations.
- Report the contracted claim capability explicitly from the bridge and keep
  every dormant/incompatible path exactly as unavailable as it is today.
- Run each projection in a fresh review root and derive structural results only
  from the contracted projection facts.
- Preserve one bridging layer of authority: the bridge returns bounded facts
  with `structuralStatus: null`; only the seam calibrates a structural result.

**Non-Goals:**

- No dependency-graph projection through `--children`/`--depends`, no
  `challenge`/`accept`/`release` verbs, no per-node state semantics beyond the
  bounded recording check, and no verification or validation claim.
- No new fixture envelope, no parser loosening, no change to the executing
  policy, activation composition, or webview.

## Decisions

### Contract only observed capture shapes

New capture operations use fixed argv with `<node-id>`, `<statement>`, and
`<workspace>` placeholders, and the sanitizer redacts content-bearing fields
(`context`, `statement`, and the existing content placeholders) so no statement,
context, or host path can be stored. Live parsers retain only bounded facts
(claim: node id, role, claimed; refine: parent id, child ids and count) and
discard everything else; fixture mode supplies explicitly closed test parsers
for the new operations instead of inventing a fixture envelope.

**Alternative considered:** extending the synthetic `af-runtime-fixture-1`
envelope with claim/refine shapes. Rejected: the fixture envelope is a test
double, and the plan requires the production parser to be derived from real
captures.

### Keep the bridge as the authority boundary and declare capability explicitly

The bridge gains the two contracted operations and an explicit side-effect-free
capability report that is exactly `{ supported: true, operation:
"claim_projection" }` when it contracts them. Capability discovery never
preflights, spawns, allocates, or reads status. `structuralStatus: null` stays
unchanged on every bridge result; the seam alone calibrates a structural
outcome.

**Alternative considered:** inferring claim capability from a ready preflight
or a successful `status`. Rejected: the existing requirements explicitly forbid
treating compatibility, initialization, or status as claim projection, and the
previous correction requires an explicit report.

### Rotate the review root per projection

`init` and `claim` are one-shot per workspace, so each projection begins with a
review root that no earlier projection has initialized: the preflight-allocated
root is used for the first projection, and after a projection has initialized
it, the bridge cleans it up and allocates a fresh contained root. Cleanup or
allocation failure is audit-failed with no retry under weaker containment.

**Alternative considered:** reusing one workspace and refreshing the claim or
probing `status` for claim state. Rejected: it needs per-node claim-state
semantics and cross-review accumulation, and it produces ambiguous read-backs.

### Derive structural results only from the projection facts

The projection runs, per validated graph, within one fresh review root:
`init` with the bounded conclusion statement, `claim` of the root node with the
host-fixed prover identity (never graph- or model-derived), one or more `refine`
calls that record every remaining claim statement as a child within the fixed
argv bounds, and a `status` read-back.

Calibration table:

| Observed projection facts | Outcome |
| --- | --- |
| Every operation succeeds; each refine reports `success` with the expected child count; status reports exactly one node plus the projected claim count | `structurally_checked` |
| Any incomplete or unexpected read-back | `unresolved` |
| Statement or count outside the fixed argv bounds (no truncation) | `unavailable` (`oversized`) |
| Any bounded bridge failure | `unavailable`/`audit_failed` per the bridge classification |

The mapper's existing evidence calibration and recorded-structure interpretive
boundary stay unchanged, so weak or conflicting evidence still downgrades a
structural result and never upgrades evidence state.

**Alternative considered:** mapping AF node epistemic/taint states
(`pending`/`unresolved`) to structural statuses. Rejected: a fresh recording
always reports non-validated states, so that mapping would publish an
uninformative `unresolved` for every clean projection and would imply
validation semantics that the contracted operations do not perform.

### Keep activation wiring and security posture unchanged

The extension keeps its single preflight, the existing capability check before
constructing `ClaimProjectionReasoningReviewController`, and the bounded
`claim-capability-unavailable` fallback. Only the source pins that hard-code the
unsupported seam need amending, through the explicit spec deltas, and every
existing prohibition (no fixture seam in production, no model-visible route, no
arbitrary argv/executable/workspace, no Chat sandbox or profile use) is
retained.

**Alternative considered:** renaming the factory/module. Rejected as
unnecessary churn; the security-negative suite pins the current factory name and
the fail-closed fallback stays inside it.

## Migration Plan

There is no persisted-data, workspace, configuration, profile, or protocol
migration. Rollback restores the hard-coded unsupported seam and removes the
claim/refine operations, parsers, capture fixtures, and rotation; the existing
unavailable controller remains the safe fallback.

## Risks / Trade-offs

- [AF 0.1.x output drift] -> strict parsers; any mismatch is a bounded failure
  with no guessed state.
- [Recorded-tree false confidence] -> recording-only calibration, explicit
  boundary text, evidence-based downgrade, and no validation claim.
- [Cross-review contamination] -> fresh review root per projection; read-back
  integrity is checked against the projected claim count.
- [Capture fixture staleness] -> one manifest per capture set, regenerated
  together, with the gated integration test asserting the stored shapes parse.

## Open Questions

None.
