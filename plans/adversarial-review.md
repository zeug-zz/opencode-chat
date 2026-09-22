# Adversarial-Review Enablement — Phases 2-4

Status: planning. Phase 1 is scaffolded and in implementation:
`openspec/changes/add-vibefeld-af-discovery/`. Phases 2-4 below are NOT yet
scaffolded; they need their own OpenSpec change(s) before implementation.

Authoritative context: `plans/vibefeld-scribe.md`, the completed change
`add-vibefeld-restricted-contexts`, and the two review records under
`plans/security/` (2026-09-22).

## Phase 1 (in flight, for reference)

AF non-dormant: home-relative discovery roots (`~/go/bin`, `~/.local/bin`,
`~/bin`) behind the existing uid-owned + executable checks, plus an optional
host-owned `opencode-chat.vibefeld.afPath` setting read once at activation.
Root cause on the dev host: `af` 0.1.11 lives at `~/go/bin/af` while discovery
scans only four system roots plus the extension-host PATH, and Dock-launched VS
Code hosts have a minimal PATH.

## Phase 2 — Adversarial where needed (composition)

Goal: a manual review runs the AF claim projection and the restricted
prover/verifier stages together. Adversarial review stops being a
claim-unavailable fallback and becomes an explicit part of the deep review.

Planned shape:

- Selection change: when both capabilities are generation-ready, construct the
  claim-projection controller and the restricted provider together and select a
  composition controller; keep the existing precedence when only one is ready.
- Composition controller: claim projection first, adversarial stages second on
  the same bounded packet; one in-flight review per session/message; manual
  trigger only; existing 60 s total / 30 s stage budgets; hidden registry,
  unconditional cleanup, and generation-bound readiness revalidation reused
  unchanged.
- Merge rules: claim-projection status, assumptions, and evidence stay
  authoritative; adversarial objections append as redacted `openChallenges`;
  role agreement never upgrades to `structurally_checked`; an adversarial
  failure does not erase a valid claim result; no response gating.
- Trigger policy (OPEN DECISION): (a) conditional — run adversarial only when
  the claim result is `unresolved`, `audit_failed`, or carries conflicted
  evidence (recommended: bounded cost, targets uncertainty); (b) always run
  both on every manual review; (c) a new availability-gated preference toggle.
- Child model (OPEN DECISION): keep reusing the host `opencode.json` default
  model (current behavior), or add a dedicated `vibefeld.reviewModel` setting.
- Non-goals: no core/protocol/webview shape change (reuse
  `ReasoningReviewSummary`), no model-visible routes, no automatic routing, no
  response gating, no persisted review traces.

Acceptance: focused fake-driven tests for every merge/trigger branch; negative
tests retained; one gated live smoke with a real provider.

## Phase 3 — Ready-to-go live enablement evidence

- Run both gated live suites (`restricted-review-live`, and the visibility
  companion) plus a composed live smoke against a real provider/model.
- Fix whatever the live run breaks: structured-output viability of the stage
  instructions, wildcard/dynamic tool denial, hidden filtering under real event
  ordering, delete persistence.
- Record the evidence as a dated record under `plans/security/` with server
  build, model, and dispositions; no secrets or raw prompts in the record.

Acceptance: recorded live proof; every unknown from the 2026-09-22 round-2
review either proven or explicitly carried with its bounded fallback.

## Phase 4 — Verification and release gate

- Focused suites, `pnpm run check`, `pnpm run build`, `pnpm run test:all`,
  `openspec validate --strict`, `git diff --check`.
- Diff review for scope creep and untraceable additions; docs touch-ups
  (`README.md`/`SECURITY.md`) only if behavior claims change.
- Archive decision for the completed changes; no archive without explicit user
  request.

## Open decisions (blocking Phase 2 scaffolding)

1. Adversarial trigger: conditional weak-result (recommended) / always-both /
   preference toggle.
2. Child model source: host default vs dedicated setting.
3. Automatic routing: keep manual-only for now, or schedule the separate
   calibration-gated `add-vibefeld-automatic-routing` change.
4. Live-proof budget: approval to spend real model calls in Phase 3.
