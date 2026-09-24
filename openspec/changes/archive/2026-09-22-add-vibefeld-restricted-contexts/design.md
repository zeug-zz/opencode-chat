## Context

See `proposal.md` and `plans/vibefeld-scribe.md` (Prerequisites, Decisions
2026-09-21, and the deferred-adversarial-review decision). The predecessor change
`add-vibefeld-adversarial-review` shipped the contract, validators, orchestrator,
mapper, and controller, with `createUnsupportedAdversarialReviewSeam` as the only
production seam. This change supplies the real `RestrictedReviewAdapter`, the
host-side hidden registry, and the selection path.

Two adversarial review rounds ran on 2026-09-22 and their findings are folded in
below: `plans/security/restricted-contexts-review-20260922.md` (planner round)
and `plans/security/restricted-contexts-review-round2-20260922.md` (independent
security and feasibility subagent lenses). Key corrections from round 2:
authoritative deny inventory, generation-bound readiness, host-side hidden
session registry, unconditional and awaited cleanup, serialized cancellation,
manual-only routing pin, stage-reason redaction, and the plugin/MCP scope note.

Verified during planning and review:

- `buildChatOverlay` (`opencode-agent.ts`) feeds both the unsandboxed launch path
  and the sandboxed `OPENCODE_CONFIG_CONTENT` path; no configuration file is
  written for extension behavior and the independent TUI keeps its own server.
- The lockfile-resolved SDK (`@opencode-ai/sdk` 1.18.18; manifest `^1.18.18`)
  exposes `AgentConfig` (`model`, `prompt`, `tools`, `disable`, `mode`,
  `maxSteps`, `permission`, `hidden`), session `create` (`parentID`, `title`),
  `prompt`/`promptAsync` (`agent`, `system`, `tools`, `model`, `parts`),
  `abort`, `delete`, and `config.get()` returning the effective `Config`
  including the `agent` map.
- The contract's `identifier` rule is `^[A-Za-z][A-Za-z0-9_-]*$` (≤64), and
  provenance fixes prover `contextNumber: 1` and verifier `2`; raw session ids
  are digit-leading UUIDs and therefore invalid as identities or handles.
- `AdversarialReviewOrchestrator` has only a single total `timeoutMs`
  (`adversarial-review-orchestrator.ts:24-54`, default `5_000` ms) and
  `adversarial-review-reasoning-review-controller.ts:21-28` constructs it
  without options, so the controller wiring must set the explicit total.
- Session mapping (`opencode-agent.ts:1067-1070`), event publication
  (`chat-view-provider.ts:1289-1308`), and agent/session refresh
  (`chat-view-provider.ts:967-1010`) currently filter nothing;
  `extension.ts:821-824` only disconnects on deactivation.
- Production selection (`extension.ts:770-805`) chooses claim projection or
  unavailable; the claim capability is a constant `supported: true`
  (`vibefeld-runtime.ts:122-130,150-153`), so the adversarial branch is dormant
  by construction on the current host.
- Live suites gate on the existing live-test opt-in (task 7.1 reuses it).

## Goals / Non-Goals

**Goals:**

- Let an explicit manual review run one bounded prover and one bounded verifier
  stage over a hidden restricted child context, using the user's configured
  OpenCode provider, without granting tools, repository access, shell, task
  delegation, MCP, plugins, or AF workspace authority.
- Verify from the extension-owned server's own effective configuration, without
  a model call at readiness, that the restricted agent is present with every tool
  denied — while being explicit that this is configuration verification bound to
  the current server generation, not enforcement proof.
- Keep the provider, provenance, and sessions host-private, filtered from every
  user-visible surface, and unretained.
- Change only controller selection and deactivation disposal in `extension.ts`;
  keep core, protocol, and webview untouched, and never downgrade the
  claim-projection result.

**Non-Goals:**

- No user-visible or persisted agent, tool, plugin, MCP server, or task target.
- No second or plugin-free server instance: host-configured plugins and MCP
  servers remain trusted host extensions in the same extension-owned server
  process, and this change's denial claim covers the restricted agent's
  model-callable authority only.
- No OS-level sandbox claim; enforcement evidence is the gated live proof, and
  any independently enforced isolation remains a separate future obligation.
- No composition of claim projection and adversarial stages in one review; that
  is a recorded follow-up decision, not silent behavior.
- No new settings surface in the first version: the existing manual review
  affordance and availability preference remain the only user controls, and
  automatic routing never invokes adversarial review.

## Decisions

### Hidden restricted agent overlay built through `buildChatOverlay`

Extend `OpenCodeLaunchConfiguration` with one restricted-review agent entry and
merge it into the in-memory overlay the agent package already builds. The entry
pins a deny map derived from the authoritative tool and permission inventory —
every concrete authority (`read`, `glob`, `grep`, `edit`, `write`, `patch`,
`bash`, `task`, `webfetch`, `websearch`, `skill`, `todo`/`todowrite`,
`question`, `lsp`, `list`, `external_directory`, `doom_loop`, and any
dynamically present tool names from installed plugins or MCP servers) plus the
`"*"` wildcard — and rejects any unknown authority rather than passing it
through. The entry carries a fixed host-owned `prompt` instruction, the
host-resolved child model, a small `maxSteps`, and hidden mode semantics. Child
prompts additionally pass `agent: <restricted name>`, the host-pinned `model`, a
fixed `system` instruction, the same deny map, and only the bounded packet text.

This supersedes exactly the predecessor non-goal "Do not change … OpenCode
overlays" and the plan's no-agent wording, narrowly: one hidden agent inside the
extension-owned server's in-memory configuration, never persisted, never
user-visible, never in the TUI or global configuration. Host-configured plugins
and MCP servers remain trusted host extensions sharing that process; the
restricted denial covers model-callable authority only and is not a claim about
those host extensions.

**Alternative considered:** per-prompt `tools` denial only. Rejected: the
lockfile-resolved line's wildcard semantics are unproven, and a prompt-level map
cannot be read back and verified from the server.

**Alternative rejected:** user-visible `vibefeld-prover`/`vibefeld-verifier`
agents or `task` delegation. Both are model-visible and carry broader authority.

### Configuration-verified, generation-bound readiness preflight

The provider reports `supported: true` only when both hold: the host composed the
restricted overlay for the current server generation, and a read-only inspection
of the extension-owned server's effective config shows the restricted agent
present with every enumerated tool denied and the expected host-pinned model and
instructions. The check creates no session, spawns no process, writes no
configuration, and makes no model call; any mismatch, malformed read-back, or
generation change (reconnect, relaunch, overlay change) invalidates readiness,
and a cheap recheck runs before each review. The check proves configuration, not
enforcement: it SHALL NOT be described or published as enforced isolation, and
enforcement evidence is the gated live proof plus the provider implementation.

**Alternative considered:** a live probe prompt as the readiness proof. Rejected:
it costs a model call per activation and is weaker evidence than the server's own
tool policy for configuration; end-to-end behavior is covered by the gated proof.

**Alternative rejected:** trusting an arbitrary effective-config read without the
generation binding. Rejected: it can false-positive against a stale or foreign
configuration.

### Minted, pattern-safe provenance identities

The provider mints bounded letter-leading identities and handles
(`prover-<token>`, `verifier-<token>`, ≤64 chars, `^[A-Za-z][A-Za-z0-9_-]*$`),
never derived from packet content, and uses the fixed context numbers (prover 1,
verifier 2). Raw SDK session ids are digit-leading and invalid; they stay private
to the provider and are never published.

**Alternative rejected:** using the session id as the identity. It fails the
contract's identifier rule and would leak provider internals.

### Provider in the agent package, adapter in the vscode platform

The provider (session create/prompt/cancel/delete, overlay data, readiness read,
bounded text retrieval) lives in `packages/agents/opencode/` as a narrow
non-`IAgent` module, because SDK access belongs there. The vscode vibefeld
adapter wraps it into `RestrictedReviewAdapter` and supplies the exact fixed
attestation; the existing seam validators remain the gate. The production
adapter is constructed internally only and is not an injection surface; the
attestation is a contract check, and enforcement rests on the provider code and
the live proof. Stage-derived reason text is normalized with host-applied
redaction of path-, URL-, and secret-like patterns and hard bounds before
projection, so raw child text never reaches the summary. `IAgent`,
`packages/core`, and the webview protocol are untouched.

**Alternative considered:** extending `IAgent` or the shared protocol with the
child API. Rejected: broader surface, model-adjacent, and unnecessary.

### Bounded stages, serialized cancellation, and redacted reasons

Each review runs at most one prover and one verifier stage, with at most two
child sessions alive and one in-flight review per session/message; a newer review
cancels the previous one and cancellation is awaited before the next begins. The
provider enforces its own per-stage deadline (≤30 s) around the bounded text
retrieval, and the host sets the orchestrator's explicit total timeout (default
60 s) at controller construction, replacing the unusable 5 s default. Stage text
is obtained through a bounded await within the stage deadline, is validated by
the existing exact-key bounded validators, used only to produce redacted
findings, and discarded; a publication generation token is checked before any
result is published, and late or superseded results are dropped. No automatic
retries.

**Alternative rejected:** relying on the orchestrator default timeout,
unbounded event waits, or marker-timing alone. Each turns model latency into
failed, leaked, or misordered reviews.

### Host-side hidden-session registry and unretained lifecycle

The provider registers every created child session id with the host at creation;
the extension filters those ids from session-list mapping, agent lists, and
webview event publication (buffering events that arrive before registration
resolves), so hiddenness does not depend on title matching. Child sessions use
fixed marker titles containing only a random token (never packet content),
retained solely for startup scavenging of sessions left by a crashed process.
Every review aborts and deletes its sessions unconditionally in a `finally` on
success, failure, timeout, or cancellation; extension deactivation awaits
disposal; startup scavenges leftover marked sessions. No packet, proposal,
verdict, or trace is persisted; only the existing bounded
`ReasoningReviewSummary` is published.

**Alternative considered:** leaving child sessions for inspection or relying on
title filtering alone. Rejected: retention and visibility are exactly what the
plan's hidden-context requirement excludes, and marker-only filtering was shown
to be bypassable.

### Selection precedence: claim projection first, adversarial second, manual only

When the claim capability is available, the claim-projection controller keeps
selection so the AF-backed structural result is never replaced by a weaker
adversarial summary. When only the restricted provider is ready, the manual
review selects the adversarial controller (which compiles the bounded claim graph
and runs the prover/verifier stages). Otherwise the bounded unavailable
controller remains. Automatic routing never invokes adversarial review: the
controller rejects any non-manual trigger, and the manual review click stays the
only entry point. No response is gated or rewritten. On the current host, whose
claim capability is a constant `supported: true`, the adversarial branch is
dormant by construction and serves hosts/builds without claim projection.

Composing claim projection and adversarial stages into one review — projecting to
AF and then running adversarial stages with merged calibrated statuses — is a
recorded follow-up decision, not taken silently here.

**Alternative considered:** adversarial-first precedence. Rejected: it would
silently downgrade the just-enabled claim-projection result for AF-enabled hosts.

## Risks / Trade-offs

- [Overlay semantics or the configuration read-back differ on a server build] ->
  the generation-bound preflight fails closed and the provider stays dormant; the
  gated live proof is the enablement evidence and remains the only place
  enforcement is claimed.
- [A tool stays reachable despite the deny map, including dynamically added
  tools] -> authoritative enumeration plus wildcard plus the server-side read-back
  plus a live proof that adds a dynamic tool and attempts a sentinel read, which
  must observe no tool part or content; a failure keeps the provider dormant.
- [Host-configured plugins or MCP servers observe child sessions] -> acknowledged
  out of scope by the plugin/MCP boundary; the restricted claim covers the
  child's model-callable authority, and the child's packet derives from the
  host's own session content that those extensions already serve.
- [Child output could contain injection, paths, or private reasoning] -> the
  existing exact-key bounded validators reject unsafe, oversized, unknown, or
  ambiguous data without echoing it, published reasons are additionally redacted
  and bounded, and no raw child text is projected.
- [Cost, stale sessions, or crash residue] -> one prover plus one verifier stage
  per manual request, small `maxSteps`, provider stage deadline plus explicit
  total timeout, no retries, unconditional abort/delete including awaited
  deactivation, and startup scavenging of marked leftovers.
- [Selection confusion when the provider flaps, reconnects, or overlaps
  reviews] -> precedence is fixed; readiness is generation-bound and
  revalidated; reviews are serialized and cancelled with a generation token
  before the next begins.

## Migration Plan

No persisted data, protocol, configuration file, workspace, or profile
migration. Rollback removes the overlay field, provider module, adapter,
registry/filtering hooks, selection branch, and tests; the claim-projection and
unavailable paths remain the safe fallback.

## Open Questions

- Only one: whether to compose claim projection and adversarial stages into a
  single review with merged calibrated statuses. Deferred by decision; the
  current scaffold keeps claim projection selected when available.
