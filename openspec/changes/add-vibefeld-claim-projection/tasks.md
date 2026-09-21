## 1. Private Claim Graph Contract

- [x] 1.1 Add platform-private bounded claim, assumption, dependency, evidence-reference, and validation-result types under `packages/platforms/vscode/src/vibefeld/`; verify AF-specific fields remain outside `packages/core` and the webview protocol.
- [x] 1.2 Implement deterministic compilation from the existing visible-text source packet and graph validation for bounded text, node/depth/edge limits, unique identifiers, allowed claim classes, dependency existence, acyclicity, and unsafe-value rejection; verify focused tests cover valid, malformed, cyclic, duplicate, missing, unsafe, and over-limit graphs.

## 2. Evidence Separation And Status Mapping

- [x] 2.1 Add host-private evidence metadata normalization that separates logical dependencies from evidence dependencies, preserves `not_required`, `source_recorded`, `unverified`, `human_verified`, and `conflicted`, and never stores source excerpts or raw provider data; verify conflict and evidence-boundary tests.
- [x] 2.2 Add calibrated mapping from graph, evidence, and bounded bridge outcomes to `ReasoningReviewSummary` statuses and conclusions; verify structural success is allowed only for adequate evidence, weak/conflicting evidence downgrades safely, and failures never synthesize structural review or truth claims.

## 3. Capability-Gated AF Projection Seam

- [x] 3.1 Add a narrow platform-private claim-projection seam with explicit capability reporting, normalized structural-result types, cancellation, and bounded failure mapping; verify the seam rejects raw argv, paths, commands, ledgers, prompts, and unbounded output.
- [x] 3.2 Integrate the current `VibefeldRuntimeBridge` boundary without adding an unobserved AF operation: `version`, `schema`, `init`, and `status` remain the only supported operations and `structuralStatus: null` remains non-structural; verify no-claim-capability tests return unavailable/non-structural results and do not call `status` as a claim operation.
- [x] 3.3 Add a fixture/private test seam for explicit normalized claim results only when a fixture declares claim capability; verify the seam is test-only, not activation-wired, and maps supported structural, conditional, unresolved, refuted, unavailable, and audit-failed outcomes safely.

## 4. Manual Controller Integration

- [x] 4.1 Extend the existing host-owned reasoning-review controller path to compile and validate the bounded graph from the existing source packet, check claim capability lazily, and publish calibrated summaries through the existing protocol; verify the original response, `IAgent`, core types, protocol discriminants, and webview card remain reused rather than expanded.
- [x] 4.2 Preserve cancellation, session/message tokens, session switching/deletion, invalid-message rejection, and stale-result suppression across graph compilation and projection; verify focused extension-host tests show cancelled or stale results never publish.
- [x] 4.3 Keep construction and ordinary activation dormant, with no AF preflight, proof-root allocation, config/profile/workspace change, or process launch until an explicit manual request; verify activation and ordinary Chat/Write tests preserve the existing unavailable-safe behavior.

## 5. Security Negatives And Fixture-Only Verification

- [x] 5.1 Add security-negative coverage proving no adversarial child model, response gate, automatic route, model-visible AF/plugin/MCP/tool access, agent/task permission, Scout/Write/worker authority, Chat sandbox reuse, or independent TUI/config/profile mutation is introduced; verify source/protocol/launch configuration assertions and side-effect spies.
- [x] 5.2 Add default fixture-only tests for graph validation, evidence conflict, safe status mapping, cancellation, stale state, current bridge structural-null behavior, malformed/oversized output, and unsupported capability; verify no AF binary, shell, network, user profile, absolute `/tmp` path, or global configuration is required.

## 6. Verification

- [x] 6.1 Run focused claim-projection and extension-host tests with the extension-host Vitest configuration and verify the default fixture-only path passes without live AF inputs.
- [x] 6.2 Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`; verify no source, workspace, configuration, profile, protocol, or predecessor OpenSpec change outside this change is modified.
- [x] 6.3 Run `openspec validate add-vibefeld-claim-projection --strict` and `git diff --check`; inspect the final diff for scope creep and verify no commit, push, existing change edit, or source edit occurs as part of planning-only preparation.
