# Restricted Contexts — Adversarial Review (2026-09-22)

Reviewer: planner/verifier agent (orchestrator), OpenCode Scribe.
Target: `openspec/changes/add-vibefeld-restricted-contexts/` scaffold
(proposal, design, specs, tasks), written 2026-09-22.
Status: review complete; scaffold corrected in place. One decision item still
requires an owner call (F8).

Note on independence: two independent red-team delegations (security lens and
feasibility lens) were attempted and both failed on subagent usage limits before
reading anything. This review was therefore conducted directly by the planner
with file-level evidence. An independent re-run is recommended once quota is
available; findings below are written so a fresh reviewer can falsify each one.

## Method

Adversarial attack on the scaffold's security and feasibility claims against the
actual pinned SDK (`@opencode-ai/sdk` 1.18.18), the extension-owned server
overlay path, the adversarial-review contract/validators/orchestrator, and the
repository's security invariants and plan decisions.

Evidence anchors:

- `plans/vibefeld-scribe.md` (Prerequisites ~336-353; decisions ~601-611)
- `packages/agents/opencode/src/opencode-agent.ts` (`buildChatOverlay` 129,
  `connectUnsandboxed` 645, `OPENCODE_CONFIG_CONTENT` 779,
  prompt body 1085-1115)
- `packages/platforms/vscode/src/vibefeld/adversarial-review-contract.ts`
  (attestation 20-60, context metadata 62-74)
- `.../adversarial-review-validation.ts` (`identifier` 30/70,
  `normalizedProvenance` 90-112, attestation 114-148)
- `.../adversarial-review-orchestrator.ts` (packet build 73-83, timeout default
  5_000 at 62)
- `packages/platforms/vscode/src/extension.ts` (`selectReasoningReviewController`)
- SDK types: `AgentConfig` 835, `Config.agent` 1105, `SessionCreateData` 1811,
  `SessionPromptData` 2249, `ConfigGetData` 1668

## Findings

### F1 — "server-verified" overstates what `config.get()` proves (HIGH)

`config.get()` returns the server's loaded *configuration*. It cannot prove that
the runtime honored the deny-all tool map for a given prompt, that wildcard
semantics applied, or that no plugin/MCP tool leaked into the agent. The
scaffold's readiness wording implied enforcement.

Disposition: fixed. Readiness is now explicitly *configuration-verified*, must
not be described as enforced isolation, and enforcement evidence is assigned to
the gated live proof. The provider stays dormant on any mismatch.

### F2 — `tools: {"*": false}` wildcard semantics are unproven in the pinned line (HIGH)

The design leaned on a wildcard deny map. If the pinned server ignores `"*"` (or
does not cover MCP/plugin/skill/subagent tools), the child could still call a
tool.

Disposition: fixed. The overlay and the prompt map must now enumerate the
concrete tool authorities (read, glob, grep, edit, write, patch, bash, task,
webfetch, websearch, skill, todo, plus any MCP `server_tool` names present) in
addition to the wildcard, and the gated live proof must show no tool invocation.

### F3 — Identity/handle rules make raw session ids invalid (HIGH, feasibility)

`identifier` requires `^[A-Za-z][A-Za-z0-9_-]*$` (≤64) and
`normalizedProvenance` fixes prover `contextNumber: 1` / verifier `2`. A raw
session id (often digit-leading) fails the pattern, and handles must be opaque
but pattern-valid.

Disposition: fixed. The spec now requires the provider to mint bounded
letter-leading identities and handles (`prover-…`/`verifier-…`), never derived
from packet content, and to use the fixed context numbers.

### F4 — Orchestrator default timeout is unusable for model calls (HIGH, feasibility)

`AdversarialReviewOrchestrator` defaults `timeoutMs` to `5_000` for the whole
review. Two child model calls cannot complete in 5s, so a naive wiring would
time out every review.

Disposition: fixed. The scaffold now requires a host-owned bounded total timeout
(default 60 s) with per-stage bounds (≤30 s), explicitly set at construction,
with cancellation and context cleanup on timeout.

### F5 — Child final-text retrieval was unspecified (MEDIUM)

`SessionPromptData` returns the created message; whether it blocks to completion
is not proven, and the scaffold never said how the bounded child text is
obtained and bounded.

Disposition: fixed. The spec now requires a bounded await on the stage result or
a bounded event wait with the stage timeout, discards the text after validation,
and never retains it.

### F6 — Child-session visibility had gaps (MEDIUM)

Marker filtering was specified, but not the no-content-in-title rule, the event
exclusion point, or cleanup on deactivation; a crash or deactivation could leave
marked sessions alive.

Disposition: fixed. Titles are fixed markers with a random token only; the
extension session-list mapping and webview event path must both exclude marked
sessions; deactivation must cancel in-flight reviews and delete child sessions;
at most two child sessions may exist at once.

### F7 — Attestation remains shape-only; the real boundary is host code (MEDIUM)

The validator proves the attestation's exact shape, not enforcement. Because the
production adapter is host-constructed, the risk is provider bugs, not a lying
third party — but the scaffold should say so.

Disposition: fixed. The spec/design now state that the production adapter is not
injectable (constructed internally only), that the attestation is a contract
check, and that all enforcement claims depend on the provider implementation and
the live proof.

### F8 — Selection precedence silently downgrades claim projection (HIGH, decision needed)

"Adversarial first" would replace the just-enabled claim projection (AF
structural result) with an adversarial summary that can publish only
`conditional` at best when no objection is confirmed. That is a behavior
downgrade for AF-enabled hosts.

Disposition: scaffold changed to **claim projection first when available;
adversarial review when only the restricted provider is ready; unavailable
otherwise**. This keeps both paths honest: adversarial review serves hosts
without AF, and composition of the two (a single review that projects to AF and
runs adversarial stages, merging calibrated statuses) is recorded as a follow-up
decision rather than silently taken here. Owner may still choose to fund
composition later.

### F9 — Predecessor non-goal conflict needed an explicit supersession (MEDIUM)

`add-vibefeld-adversarial-review` declares "Do not change … OpenCode overlays"
and the plan says no `vibefeld-prover`/`vibefeld-verifier` agents. KISS says
non-goals are binding. Adding a hidden restricted agent to the extension-owned
server's in-memory config supersedes exactly that overlay clause and must say so.

Disposition: fixed. Proposal and design now record the explicit, narrow
supersession (extension-owned server overlay only; no user-visible or persisted
agent; no TUI/global-config change) and keep every other non-goal binding.

### F10 — Live proof strength (MEDIUM)

A model may decline to attempt a sentinel read, making "no tool part" weak on its
own.

Disposition: fixed. The proof now asserts the effective-config deny-all set and
the no-tool/no-sentinel response together, and must additionally prove the
hidden agent is directly invokable (resolving the `disable`/`mode` open
question); if the hidden agent cannot be invoked, the provider must not report
ready.

### F11 — Config read race is acceptable but should be stated (LOW)

The extension owns the only writer of that in-memory config, so a post-read
change is not a live threat.

Disposition: noted in design; no further change.

## Verdict

SOUND WITH FIXES. The mechanism is feasible with the pinned SDK and the existing
overlay path; the original scaffold overstated enforcement and had three
implementation-blocking specification gaps (identity pattern, timeout, text
retrieval) plus one product-level precedence defect. After the corrections
recorded here, the scaffold is implementation-ready, with F8's composition
question deferred as an explicit follow-up decision rather than hidden.
