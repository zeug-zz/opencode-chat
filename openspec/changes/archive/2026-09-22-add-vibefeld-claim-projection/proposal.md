## Why

The runtime bridge now provides a bounded host-owned compatibility boundary, but it exposes only `version`, `schema`, `init`, and `status`; its successful results deliberately keep `structuralStatus: null`. Scribe therefore needs a separate, manual post-response phase that can validate and compile a bounded claim graph, separate evidence state, and publish calibrated results without guessing that compatibility or a clean status response establishes truth.

## What Changes

- Add a platform-private claim graph compiler and validator that consumes only the existing bounded visible-text source packet, enforces bounded node/depth/identifier/dependency limits, separates logical dependencies from evidence dependencies, and rejects malformed, cyclic, duplicate, missing, or over-limit graphs.
- Add host-private evidence normalization and status mapping that keeps structural state independent from source/evidence state, marks conflicting evidence explicitly, and uses calibrated `ReasoningReviewSummary` statuses and boundaries.
- Reuse the existing manual `IReasoningReviewController`, `ChatViewProvider` request validation, cancellation/stale-result handling, reasoning-review protocol, and webview card. Keep the flow post-response and message-scoped; do not gate, delay, rewrite, or replace the original response.
- Add an optional private AF claim-projection seam. It may use fixture-derived claim operations only when the predecessor bridge explicitly supports and reports them. With the current bridge, which supports only compatibility operations and returns `structuralStatus: null`, projection SHALL stop without publishing `structurally_checked`.
- Add fixture-only default tests for graph validation, evidence conflicts, safe success/failure mapping, cancellation and stale state, dormant/security boundaries, and the current no-claim-operation behavior. Any future live claim operation remains separately gated by the predecessor bridge's prerequisites.

### Scope and Non-Goals

This is a bounded host-private manual review phase. It does not add adversarial child models, prover/verifier agents, response gating, automatic routing, model-visible AF/plugin/MCP/tool access, workspace/config/profile changes, or a new persisted review store. It does not treat AF compatibility, initialization, status, structural success, or any claim projection as proof that a source, premise, citation, empirical claim, or normative conclusion is true.

The phase does not add an unobserved AF verb, flag, schema, or fixture result. If claim operations are absent from the predecessor bridge, the implementation may validate and retain only private graph/evidence facts for mapping, but it must publish an unavailable or otherwise non-structural summary rather than synthesize a structural result.

## Capabilities

### New Capabilities

- `vibefeld-claim-projection`: Provides bounded host-private claim graph validation, evidence separation, capability-gated AF projection, safe status mapping, and manual calibrated review publication.

### Modified Capabilities

None.

## Impact

- Affected code: private modules under `packages/platforms/vscode/src/vibefeld/`, the existing injected reasoning-review controller boundary, and focused extension-host tests. Existing core types, protocol discriminants, and webview components should be reused without expansion.
- Affected behavior: a completed assistant message may receive a manual post-response summary. Until an explicitly supported AF claim operation exists, the summary remains unavailable/non-structural and ordinary Chat and Write behavior remains unchanged.
- Dependencies: no new package, model, plugin, MCP server, AF binary, workspace root, configuration file, profile, or network dependency is introduced. Default tests replay sanitized fixtures and injected private seams only.
- Compatibility impact: the existing manual request/result discriminants, `IReasoningReviewController`, `ChatViewProvider` lifecycle, `ReasoningReviewSummary`, and webview card remain the integration surface. No `IAgent`, shared protocol, OpenCode overlay, or ordinary Chat/Write behavior change is required.

## Risks and Fallback

- Risk: a valid graph or compatible AF runtime could create false confidence. Mitigation: keep graph validity, structural status, and evidence status independent; never publish structural success from the current bridge's `structuralStatus: null`.
- Risk: claim operations may remain unavailable or fail at the process boundary. Fallback: return the existing bounded manual-unavailable/non-structural summary, or `audit_failed` for a proven boundary failure, without retrying through Chat's sandbox or an unsandboxed process.
- Risk: source text may contain prompt injection, secrets, or private reasoning. Mitigation: treat it as bounded untrusted data, keep it out of instructions and summaries, reject unsafe graph values, and avoid echoing invalid input.
- Risk: a late result may cross session or message boundaries. Mitigation: reuse existing cancellation, session/message keys, and stale-result checks before publication.
