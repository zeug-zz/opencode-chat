# Restricted Contexts — Independent Review Round 2 (2026-09-22)

Two independent read-only lenses (security red-team; mechanism feasibility) run
as subagents against the `add-vibefeld-restricted-contexts` scaffold. Both
completed; no files were modified by the reviewers.

## Security lens — verdict: not security-ready (SOUND WITH FIXES)

| ID | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| S1 | HIGH | Restricted agent shares plugin/MCP authority of the extension-owned server | `opencode-agent.ts:184-216,645-660,775-788` | Scope note (host-configured extensions are trusted host components, out of the child-authority claim); deny inventory must include dynamically present tool names; live proof covers a dynamically added tool |
| S2 | HIGH | Config preflight can false-positive; read-back is not authoritative runtime enforcement | SDK types vs runtime semantics | Generation-bound readiness (host-composed overlay in the current generation + read-back); explicit non-enforcement wording; gated live proof remains the enablement gate |
| S3 | HIGH | Deny inventory omits authority classes (`list`, `todowrite`, `question`, `lsp`, `external_directory`, `doom_loop`) | `types.gen.d.ts:1333-1349` | Authoritative inventory derived from the SDK tool/permission unions incl. dynamic names; unknown authorities rejected |
| S4 | HIGH | Model-controlled `reason` text can leak secrets/paths into the published summary | `adversarial-review-validation.ts:31-35,76-83,341-353,376-386`; `adversarial-review-mapper.ts:80` | Stage reasons normalized with host redaction of path/URL/secret-like patterns and hard bounds before projection; raw child text never published |
| S5 | HIGH | "Unretained" cleanup not guaranteed: cleanup skipped on success, detached children, unawaited deactivation | `adversarial-review-orchestrator.ts:190-205`; `opencode-agent.ts:791-802`; `extension.ts:574-577` | Unconditional `finally` abort/delete; awaited deactivation disposal; startup scavenge of marker sessions |
| S6 | HIGH | Cancellation not serialized against a new review; cancel unawaited | `chat-view-provider.ts:249-253,1140-1146` | Awaited cancellation; one in-flight review per session/message; generation token checked before publication |
| S7 | HIGH | Hidden sessions/events not isolated; refresh publishes everything; marker collisions | `chat-view-provider.ts:355-380,967-1010` | Host-side hidden-session ID registry; session-list, agent-list, and event filtering with buffering; marker titles retained only for scavenge |
| S8 | HIGH | Automatic routing can invoke the selected controller, contradicting manual-only | `extension.ts:590-621`; `chat-view-provider.ts:1154-1237` | Manual-only pin: automatic routing never invokes adversarial review; controller rejects non-manual triggers |
| S9 | MED | Readiness not bound to server/configuration generation | `extension.ts:581-584,629-683` | Generation binding, invalidation on reconnect/overlay change, cheap recheck before each review |

## Feasibility lens — verdict: directionally feasible with corrections

| ID | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| F1 | HIGH | Hidden lifecycle not wired anywhere today | `opencode-agent.ts:1067-1070`; `chat-view-provider.ts:1289-1308`; `extension.ts:821-824` | Folded into tasks for registry/filtering (S7) and cleanup (S5) |
| F2 | HIGH | Per-stage timeout has no orchestrator support; controller constructs the orchestrator with defaults | `adversarial-review-orchestrator.ts:24-54`; `adversarial-review-reasoning-review-controller.ts:21-28` | Provider enforces its own stage deadline; controller wiring sets the 60 s total at construction |
| F3 | HIGH | Adversarial selection branch absent and dormant by construction (production claim capability is a constant `supported: true`) | `extension.ts:770-805`; `vibefeld-runtime.ts:122-130,150-153` | Branch wired in task 4.1; current-host dormancy stated in design/proposal |
| F4 | MED | `hidden: true` alone does not prove invisibility; no host-side filtering exists | `types.gen.d.ts:1351-1378` | Registry mechanism folded (S7) |
| F5 | LOW | SDK is lockfile-resolved 1.18.18, manifest `^1.18.18` — not an exact pin | `pnpm-lock.yaml:34-38` | Wording corrected to "lockfile-resolved" |

Verified: overlay reaches both launch paths (`opencode-agent.ts:645-795`);
`config.get()` returns the effective config including the agent map; existing
validators enforce attestation, roles, identity format, context numbers, and
bounded shapes (`adversarial-review-contract.ts`,
`adversarial-review-validation.ts`); summary publication at
`chat-view-provider.ts:529-548`; live suites gate on `OPEN_CODE_LIVE_TESTS`.

Unknowns requiring live proof (also asserted by task 7.1): whether the server
enforces wildcard/concrete deny including dynamically added tools; whether
`hidden` is honored; whether child sessions and events can be withheld before
publication; whether bounded stage text is retrievable without tool output or
sentinel content; whether deletion removes persisted sessions; and whether model
resolution and overlay read-back behave as expected on the shipped build.
