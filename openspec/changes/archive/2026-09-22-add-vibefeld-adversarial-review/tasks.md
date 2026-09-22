## 1. Restricted Child-Review Contract

- [x] 1.1 Add platform-private types for the `prover` and `verifier` roles, exact deny-by-default permission attestation, bounded context/provenance metadata, review packet, objection proposal, verifier disposition, and bounded failure outcomes; verify no AF paths, commands, prompts, raw ledgers, provider payloads, or new `packages/core`/webview fields are present.
- [x] 1.2 Add runtime validators for exact capability keys, forbidden permissions, role/provenance identity, context metadata, bounded packet values, objection targets/severities, verifier dispositions, and unsafe or oversized text; verify malformed, duplicate, self-accepting, unknown-field, unknown-target, and over-limit inputs fail closed without echoing payloads.

## 2. Host-Private Adapter and Orchestration

- [x] 2.1 Add the restricted child-review seam with an unavailable default and an explicitly injected adapter contract; verify the default never creates a context or invokes a delegate and a valid attestation is required before either role can run.
- [x] 2.2 Implement lazy two-stage orchestration that compiles/validates the existing private claim/evidence packet, creates distinct prover and verifier contexts, sends only bounded typed data, rejects context/provenance reuse and self-acceptance, and propagates cancellation and bounded timeouts; verify focused tests cover call order, distinct identities, verifier inputs, cancellation, timeout, and no broad-authority retry.
- [x] 2.3 Normalize child failures, malformed or ambiguous results, and cleanup/cancellation outcomes into bounded unavailable, audit-failed, or unresolved facts; verify no raw child output, command, path, prompt, or hidden reasoning reaches the result.

## 3. Calibrated Review Integration

- [x] 3.1 Map normalized prover/verifier outcomes and existing evidence metadata to the provider-neutral `ReasoningReviewSummary`; verify confirmed objections become bounded open challenges, rejected objections remain conditional, evidence conflicts remain independent, and adversarial agreement never becomes `structurally_checked`, `refuted`, or a truth claim.
- [x] 3.2 Add a private adversarial-review controller that reuses the existing bounded source packet, claim graph compiler, evidence normalization, `IReasoningReviewController`, and message-keyed lifecycle; verify unsupported capability remains unavailable and valid manual work does not mutate the original assistant response or shared protocol.
- [x] 3.3 Preserve cancellation, session/message token invalidation, stale-result suppression, and invalid-target behavior across adversarial orchestration; verify late, cancelled, switched-session, deleted-session, invalid-message, and newer-review results are not published.

## 4. Security Boundaries and Fixture Verification

- [x] 4.1 Add deterministic fixture-only adapters and focused tests for valid dual-role review, objection confirmation/rejection, evidence conflict, provenance violations, malformed/oversized output, model failure, timeout, and cancellation; verify tests use no AF binary, child service, shell, network, user profile, active workspace, or absolute `/tmp` path.
- [x] 4.2 Add extension-host security-negative coverage proving adversarial review is not wired into activation or exposed through `IAgent`, OpenCode task delegation, plugins, MCP, custom tools, Scout, Write, worker permissions, webview protocol, Chat sandbox, AF runtime, configuration, or nono/profile mutation; verify the existing unavailable controller and ordinary Chat/Write behavior remain unchanged.

## 5. Verification

- [x] 5.1 Run focused adversarial-review, claim-projection, reasoning-review, and extension-host tests with the repository's extension-host Vitest configuration; verify the default unsupported path and fixture-only capability path pass without live child-model or AF inputs.
- [x] 5.2 Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`; verify no unrelated prior change, shared contract, configuration, permission boundary, or active workspace behavior is modified.
- [x] 5.3 Run `openspec validate add-vibefeld-adversarial-review --strict` and `git diff --check`; inspect the final diff for scope creep and verify no commit, push, archive, or history mutation is performed.
