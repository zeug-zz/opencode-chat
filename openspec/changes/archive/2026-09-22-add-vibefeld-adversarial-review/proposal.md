## Why

The manual claim-projection phase can validate a bounded argument and keep evidence separate, but it has no safe way to obtain an independent adversarial objection or verification result. The existing OpenCode task and agent paths are intentionally too powerful for this purpose, so Scribe needs a host-private, contract-first child-review boundary before any prover/verifier capability can be considered.

## What Changes

- Add a platform-private contract for two distinct restricted review roles: a prover that proposes bounded objections and a verifier that independently evaluates those proposals.
- Define an explicit permission attestation for child contexts that grants only a bounded review packet and schema-constrained proposal/verdict exchange, while denying repository access, edits, shell, package, terminal, arbitrary task delegation, AF workspace, plugins, MCP, and model-visible tools.
- Require independent provenance identities, distinct role contexts, and explicit rejection of self-acceptance or same-context verification.
- Add bounded schemas and validators for review packets, objections, verdicts, identifiers, target claim references, severities, and failure classifications. Raw prompts, child reasoning, commands, paths, ledgers, credentials, and unrestricted provider output must never cross the boundary.
- Add a lazy host-private orchestration seam and controller that can use an explicitly injected restricted adapter, while the production/default path remains unavailable because the repository has no reviewed hidden child-model API.
- Map completed objections and verifier outcomes into the existing provider-neutral manual review summary without adding core protocol fields, claiming truth, or upgrading any result to `structurally_checked`.
- Cover cancellation, timeout, malformed output, model failure, stale work, provenance violations, evidence conflicts, and no-capability behavior with deterministic fixture-only tests and security-negative assertions.

### Scope

This change establishes and tests the restricted child-review contract and an unavailable-safe host integration. A future provider may implement the adapter only after independently proving the context and permission guarantees required by the contract. The current activation continues to construct the unavailable controller; no live child model is enabled by this change.

### Non-Goals

- Do not add `vibefeld-prover` or `vibefeld-verifier` OpenCode agents, task targets, plugins, MCP servers, custom tools, shell commands, or arbitrary process access.
- Do not change `IAgent`, `packages/core`, the webview protocol, Scout, Write, worker delegation, the Chat sandbox, OpenCode overlays, nono profiles, or the independent TUI.
- Do not invoke AF, infer adversarial capability from AF compatibility/status operations, create proof workspaces, or add response gating, automatic routing, or pre-response review.
- Do not persist raw source packets, prompts, child-model reasoning, ledgers, credentials, provider payloads, or full review traces.
- Do not describe an independent objection review as theorem proving, source verification, empirical validation, or proof of truth.

## Capabilities

### New Capabilities

- `vibefeld-adversarial-review`: Provides a host-private, bounded, provenance-separated prover/verifier contract and unavailable-safe manual orchestration for adversarial review.

### Modified Capabilities

None.

## Impact

- **Affected code:** New private modules and focused tests under `packages/platforms/vscode/src/vibefeld/`; reuse of the existing claim graph, evidence normalization, reasoning-review controller, and host lifecycle boundaries.
- **Public contracts:** No new shared/core type or webview/host discriminant. Existing `ReasoningReviewSummary` remains the only publication shape.
- **Dependencies:** No package, model SDK, AF executable, network service, workspace root, configuration, or profile dependency is added. Default tests use injected fakes and sanitized fixtures only.
- **Compatibility:** Ordinary Chat and Write behavior, streaming, manual review fallback, Scout permissions, worker delegation, MCP/tool policy, and extension activation remain unchanged. The default adversarial capability is unavailable and does not preflight or allocate resources.
- **Risks and fallback:** A permissive adapter could broaden child authority or allow one identity to accept its own proposal; exact permission/provenance validation, fail-closed capability checks, and negative tests prevent this. Missing, cancelled, malformed, timed-out, ambiguous, or audit-failed child results map to unavailable/audit-failed or a bounded unresolved summary and never force acceptance or structural success. If the required hidden child-model contract cannot be supplied, the existing unavailable controller remains the safe behavior.
