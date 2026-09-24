## Why

The review pipeline is fully contracted, but production reviews remain dormant:
the runtime bridge exposes only `version`, `schema`, `init`, and `status`, and
the claim seam is hard-coded unsupported, so the capability gate always
publishes `claim-capability-unavailable`. AF 0.1.11 does expose `claim`,
`refine`, and `status`, but no change has observed, sanitized, or contracted
those verb shapes, and the projection seam has never run over the real bridge.

## What Changes

- Capture and contract the real AF 0.1.11 `claim` and `refine` JSON shapes as
  sanitized checked-in fixtures, and refresh the capture set so one manifest
  describes the verified command sequence.
- Extend the fixed bridge operation union with typed, bounded `claim` and
  `refine` operations and strict live parsers that keep only bounded
  host-private facts and discard statement/context content.
- Add an explicit, side-effect-free bridge claim-capability report and a
  per-projection review-root rotation so each projection starts from a fresh AF
  root.
- Implement the claim-projection seam over the real bridge: capability from the
  bridge report, the fixed bounded projection sequence, calibrated structural
  derivation, and bounded failure mapping.

### Scope and Non-Goals

Scope: private modules under `packages/platforms/vscode/src/vibefeld/`, the
existing extension claim-capability gate, checked-in sanitized capture fixtures,
and focused extension-host tests.

Non-goals (binding): no adversarial child models or restricted contexts; no
response gating; no automatic-routing change; no `challenge`,
`resolve-challenge`, `accept`, `release`, or any other unobserved verb; no new AF
flag, placeholder, parser loosening, or fixture-shaped production evidence; no
model-visible AF/plugin/MCP/tool route; no nono/Chat-sandbox/profile/config/
workspace change; no core/protocol/webview change; no retention or export
policy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `vibefeld-runtime-bridge`: the contracted operation union gains the observed
  `claim`/`refine` operations, an explicit claim-capability report, and
  per-projection review-root rotation.
- `vibefeld-claim-projection`: the production seam becomes bridge-backed and
  derives structural results only from the contracted projection facts.

## Impact

- Affected code: `packages/platforms/vscode/src/vibefeld/`
  (`af-capture-harness`, `af-command-schema`, `af-live-output`,
  `af-parser-mode`, `af-output-schema`, `af-process-executor`,
  `vibefeld-runtime`, `current-vibefeld-claim-projection`) plus focused tests
  and fixtures; `extension.ts` behavior changes only through the
  already-contracted capability gate.
- Affected behavior: with a compatible, claim-capable runtime and a composed
  policy, manual post-response reviews publish a real calibrated summary; when
  any prerequisite is absent, the existing dormant/unavailable behavior is
  unchanged.
- Compatibility: the existing manual request/result protocol,
  `IReasoningReviewController`, `ChatViewProvider` lifecycle,
  `ReasoningReviewSummary`, and webview card are reused without expansion.
- Dependencies: no new package, model, plugin, MCP server, profile, or network
  dependency. Live capture remains explicitly gated; default tests replay
  checked-in sanitized fixtures.

## Risks and Fallback

- Risk: a recorded AF tree could be mistaken for validation. Mitigation:
  publish `structurally_checked` only from a complete observed recording, keep
  the evidence calibration and recorded-structure boundary, and never derive
  structure from compatibility, initialization, or status alone. Fallback: a
  bounded `unavailable`/`audit_failed` summary with unchanged dormant behavior.
- Risk: AF verb or output drift inside the 0.1.x line. Mitigation: strict
  parsers over the sanitized 0.1.11 shapes; any mismatch fails closed with no
  guessed state.
