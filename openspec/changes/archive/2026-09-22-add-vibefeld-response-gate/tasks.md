## 1. Private Transaction Contract and State Machine

- [x] 1.1 Define private response-gate types for capability compatibility,
  immutable drafts, bounded source packets, ownership, opaque single-use tokens,
  transaction states, calibrated decisions, terminal failures, and safe
  publication results; verify exact state transitions and no raw prompts,
  private reasoning, paths, commands, ledgers, credentials, or unsafe
  diagnostics are represented.
- [x] 1.2 Implement validators for opt-in eligibility, capability attestation,
  ownership, session/message identity, token freshness, bounded candidate data,
  calibrated summaries, and terminal transitions; verify unknown, stale,
  duplicate, malformed, ambiguous, and over-limit values fail closed without
  echoing them.

## 2. Host-Owned Transactional Insertion Point

- [x] 2.1 Add a private host-owned seam that can hold an immutable response
  before publication and exposes begin/review/release/cancel lifecycle
  operations; verify an observer/post-stream seam is classified incompatible
  and the current `promptAsync`/direct-send path is not falsely reported as
  gated.
- [x] 2.2 Integrate the seam only at a proven host publication boundary, with
  explicit opt-in and capability gating; verify unavailable or incompatible
  capability leaves ordinary Chat and Write unchanged and does not create
  drafts, tokens, child requests, AF preflights, proof roots, or configuration
  changes.
- [x] 2.3 Implement session/message isolation, ownership, generation invalidation,
  cancellation, bounded timeout, cleanup, and exactly-once release; verify stale,
  switched-session, deleted-message, concurrent, repeated, and terminal release
  attempts cannot publish.

## 3. Review and Calibrated Release Decision

- [x] 3.1 Connect the transaction to the existing bounded adversarial-review and
  reasoning-review semantics without adding a truth/proof status; verify source
  packets remain bounded, original responses remain immutable, and no raw review
  material reaches shared protocol, webview, logs, or publication.
- [x] 3.2 Map valid review outcomes to allowed `approved` or non-releasable
  decisions while preserving evidence status and interpretive boundaries; verify
  confirmed/unresolved objections, evidence conflicts, malformed/ambiguous
  outcomes, timeout, cancellation, provenance failure, and audit failure never
  release or retry through broader authority.

## 4. Fixture-Only End-to-End and Security Boundaries

- [x] 4.1 Add a deterministic in-memory fixture adapter and focused tests proving
  draft withholding, valid calibrated review, exactly-once release, second-release
  rejection, and all invalid terminal paths; verify no AF binary, child service,
  network, user profile, active workspace proof root, shell, or absolute `/tmp`
  path is used.
- [x] 4.2 Add negative coverage proving the fixture/unavailable adapter is not
  wired into normal activation and that no AF/plugin/MCP/tool/task/agent
  permission, child agent, OpenCode global config, nono/profile, proof workspace,
  Scout, Write, worker, sandbox, or independent TUI boundary changes.

## 5. Verification

- [x] 5.1 Run focused response-gate, adversarial-review, claim-projection,
  reasoning-review, and extension-host tests; verify fallback compatibility,
  stale isolation, fail-closed release, and fixture-only behavior.
- [x] 5.2 Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`; verify
  ordinary Chat and Write behavior and all existing security boundaries remain
  unchanged.
- [x] 5.3 Run `openspec validate add-vibefeld-response-gate --strict` and
  `git diff --check`; inspect the final diff for scope creep and verify no
  source files, prior changes, generated files, git history, commit, push, or
  archive operation was modified or performed.
