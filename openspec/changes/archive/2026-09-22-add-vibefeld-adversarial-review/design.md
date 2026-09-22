## Context

The existing manual reasoning-review path is host-owned, post-response, and keyed to a completed assistant message. The current claim-projection phase can compile a bounded private graph and normalize evidence, but its production seam is explicitly unsupported and the runtime bridge exposes only compatibility operations. There is no hidden child-model API in `IAgent`, OpenCode, or the extension host, and ordinary task delegation would grant authority that is forbidden for adversarial review.

See `proposal.md` for motivation and `specs/vibefeld-adversarial-review/spec.md` for the normative contract. This design therefore treats child-model execution as an injected capability boundary: the repository implements the contract, validation, orchestration, and unavailable fallback, but does not enable a live provider.

## Goals / Non-Goals

**Goals:**

- Keep all adversarial-review types and orchestration private to the VS Code platform package.
- Define an exact permission attestation and bounded packet/result schemas that a future restricted child-model provider must satisfy.
- Run prover and verifier stages only through separately created, provenance-distinct contexts.
- Reuse the existing claim graph, evidence normalization, `IReasoningReviewController`, cancellation, and stale-result lifecycle.
- Make fixture-backed adapters useful for deterministic tests without making them available during activation.
- Produce calibrated existing review summaries that surface objections without presenting agreement as proof.

**Non-Goals:**

- Implementing or selecting a real child-model SDK, OpenCode child agent, task target, plugin, MCP server, or process launcher.
- Enforcing OS-level repository/AF isolation from this change; a future provider must prove that independently before production enablement.
- Adding a new core type, protocol discriminant, webview state shape, AF operation, response gate, automatic route, or persisted review trace.

## Decisions

### Keep the contract platform-private and adapter-driven

Add a small private contract under `packages/platforms/vscode/src/vibefeld/` for the two roles, permission attestation, opaque context records, bounded review packet, normalized prover proposal, normalized verifier verdict, and bounded failure classes. The default seam reports unsupported and never calls an adapter. A test-only fixture seam may implement the contract with deterministic values.

The adapter API receives typed review data and an `AbortSignal`; it does not receive command strings, argv, paths, executable selection, workspace selection, prompts, or generic tool handles. Context creation returns only validated role/provenance metadata plus an opaque internal handle. The host stores no raw provider output.

**Alternative rejected:** adding a `vibefeld-prover` or `vibefeld-verifier` OpenCode agent, using `task`, or extending `IAgent`. Those paths are model-visible and inherit broader authority than the contract allows.

### Use an exact deny-by-default permission attestation

The capability declaration has a fixed version and an exact set of boolean denials for repository read/write, shell, package manager, terminal, arbitrary task delegation, AF workspace, plugin, MCP, and model-visible tools. It also identifies the only permitted input and output channels: a bounded review packet and schema-constrained review result. Validators reject unknown keys, missing keys, permissive values, unsupported roles, and capability claims that cannot be proven by the adapter.

This attestation is a contract check, not an assertion that the repository can sandbox an arbitrary provider. The production seam remains unavailable until an independently reviewed provider can make the attestation true.

**Alternative rejected:** a list of allowed tools or a human-readable permission string. Allow-lists and prose are easy to extend accidentally and cannot prove that forbidden authority is absent.

### Compile the review packet before child invocation

The controller first uses the existing bounded source-packet and claim-graph compiler, validates evidence metadata, and constructs a private packet containing only validated claim/evidence facts. The child stages never receive hidden message parts, tool payloads, raw prompts, or unrestricted source text. The packet is immutable and size-bounded.

The prover returns only bounded objection records with known target IDs, severity, and safe reason text. The verifier receives the same packet plus the normalized proposal and returns dispositions for known objection IDs. Exact-key and value validators reject unsafe, oversized, duplicate, missing, or ambiguous data before mapping.

**Alternative rejected:** asking a child model for free-form reasoning or a command plan. That would make output safety and prompt-injection resistance depend on provider behavior.

### Require two independently created provenance identities

The orchestrator creates a prover context and a verifier context through separate adapter calls. Each context has a distinct role, bounded provenance identity, and opaque handle. The verifier cannot run if the identities or handles are reused, if either role is mislabeled, or if the verifier output claims the prover identity. Every verdict must refer to a proposal produced by the distinct prover stage; self-acceptance is invalid.

The host does not expose private provenance identifiers in the webview summary. They exist only to enforce independence and to support bounded diagnostics without retaining raw traces.

**Alternative rejected:** one context with a prompt asking it to be adversarial. Prompt-level role separation is not independent provenance and cannot prevent self-acceptance.

### Map adversarial outcomes conservatively into the existing summary

A completed verifier result is mapped through a private mapper to `ReasoningReviewSummary`. Confirmed or unresolved material objections become bounded `openChallenges` and an `unresolved` result. If all proposals are rejected, the result may be `conditional` with a clear interpretive boundary. Unsupported, malformed, cancelled, timed-out, or audit-failed work maps to unavailable/audit-failed or a bounded unresolved result. Evidence status is copied from the existing normalization and can only weaken the result; no child outcome produces `structurally_checked`, `refuted`, or a truth claim.

This reuses the existing card and protocol rather than adding a new public adversarial-review state. The original message remains post-response and unchanged.

**Alternative rejected:** adding an `adversarially_checked` status or a boolean `accepted`. That would encourage users to interpret child agreement as source or truth verification and would require a broader provider-neutral contract.

### Keep activation dormant and lifecycle host-authoritative

The new controller and seam are constructed only by focused tests or an explicitly future host integration. `extension.ts` continues to use the existing unavailable controller. `ChatViewProvider` remains the authority for active-session validation, authoritative message retrieval, source extraction, cancellation, and stale publication. The new private controller invalidates its own in-flight role contexts on cancellation and never publishes by itself.

No AF preflight, proof-root allocation, process launch, model request, profile change, or configuration change occurs during ordinary activation or without a valid manual request.

**Alternative rejected:** reporting a child capability as available from static configuration or AF compatibility. Availability without the reviewed hidden API and permission boundary would be misleading.

### Use fixture-only verification by default

Unit and extension-host tests inject deterministic adapters that return sanitized bounded proposals and verdicts. Tests cover exact permission validation, context independence, schema failures, cancellation, timeouts, stale results, evidence conflicts, and security negatives. No default test resolves a model, network, shell, AF binary, user profile, or active workspace.

A future live integration suite must be separately gated and must supply the reviewed adapter and its own disposable boundary; it cannot weaken the default unsupported path.

## Risks / Trade-offs

- [A permission attestation could be treated as real sandbox enforcement] → Keep production capability unavailable by default, make the adapter boundary explicit, and require a future independently reviewed provider before activation wiring.
- [A child result could contain prompt injection, paths, commands, or private reasoning] → Use exact-key bounded validators, reject unsafe values, retain only normalized challenges/dispositions, and never echo invalid payloads.
- [The two roles could secretly share a model context] → Require separate creation calls, distinct role/provenance identities, distinct handles, and self-acceptance rejection.
- [No confirmed objection could create false confidence] → Use `conditional`, preserve evidence status, include an interpretive boundary, and prohibit structural-success/truth wording.
- [Cancellation could leave a late result] → Propagate `AbortSignal`, cancel both contexts, invalidate review tokens, and reuse the host stale-result checks.
- [Fixture support could be mistaken for production support] → Keep fixture adapters in test-only modules, assert they are not imported by activation, and keep the default seam unsupported.

## Migration Plan

No persisted data, protocol, configuration, workspace, or profile migration is required. The change is additive: claim projection and unavailable review behavior remain valid when the new seam is absent. Rollback removes the private contract, orchestrator, controller, fixtures, and tests; `extension.ts`, `IAgent`, the core protocol, and existing security boundaries remain unchanged. A later provider integration must separately review and prove its child-model and permission implementation before changing the dormant activation path.

## Open Questions

None. The absence or presence of a future reviewed provider is an explicit capability result and does not change the safe contract or task breakdown.
