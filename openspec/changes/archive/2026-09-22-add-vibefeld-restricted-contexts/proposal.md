## Why

Adversarial review is contracted but dormant: the restricted child-review seam is
always unsupported and `extension.ts` never selects the adversarial controller.
`plans/vibefeld-scribe.md` defers enablement to this change and requires it to
prove a restricted, hidden child-model API before any live prover/verifier stage
runs. The extension already owns a process-scoped OpenCode server and builds its
in-memory configuration overlay (`buildChatOverlay`), and the lockfile-resolved
SDK (`@opencode-ai/sdk` 1.18.18) exposes `AgentConfig` (model, prompt, `tools`
map, `disable`, `mode`, `maxSteps`, `permission`, `hidden`), per-prompt `tools`,
session create/abort/delete, and `config.get()`. A host-owned restricted child
context is therefore implementable without user-visible agents, tools, plugins,
or shared/core changes.

## What Changes

- Add a hidden restricted review agent overlay to the extension-owned server's
  in-memory configuration: a deny map derived from the authoritative tool and
  permission inventory (every concrete authority plus dynamically present tool
  names plus the `"*"` wildcard, rejecting unknown authorities), a fixed
  host-owned instruction, the host-resolved child model, bounded steps, and
  hidden mode semantics.
- Add a narrow provider module in the agent package that creates, prompts,
  cancels, and deletes provenance-distinct child sessions carrying only the
  bounded review packet, with minted pattern-safe identities, a provider-enforced
  stage deadline, awaited cancellation, and a publication generation token.
- Add a host-side hidden-session registry: child session ids are registered at
  creation and filtered out of session lists, agent lists, and webview event
  publication, with marker titles (token only, never packet content) retained
  only for startup scavenging; child sessions are cleaned up unconditionally and
  deactivation disposal is awaited.
- Add a configuration-verified, generation-bound readiness preflight: the
  provider reports ready only when the host composed the restricted overlay in
  the current server generation and the read-back confirms the agent with every
  tool denied and the expected model and instructions, read-only and without a
  model call. It is not an enforcement proof; enforcement evidence is the gated
  live proof.
- Wrap the provider as the real `RestrictedReviewAdapter` with the exact
  deny-by-default attestation, and select the adversarial controller only when
  the claim-projection capability is unavailable and the restricted provider is
  ready. Automatic routing never invokes adversarial review; the manual review
  affordance is the only trigger.
- Normalize and redact stage-derived reason text before projection so no raw
  child text, path, URL, or secret-like value reaches the published bounded
  summary.
- Add default fixture/injected tests plus one explicitly gated live proof that
  asserts effective-config tool denial (including a dynamically added tool), a
  sentinel-read probe with no tool part or content, hidden-agent invokability,
  provenance separation, cancellation, deletion on success and failure, hidden
  visibility, and no configuration file writes.

### Scope and Non-Goals

Scope: the agent-package provider and in-memory overlay, the vscode
adapter/selection, the host-side hidden registry and filtering points, the
hidden session lifecycle, focused tests, and one gated live proof suite.

Supersession (explicit, narrow): this change supersedes only the predecessor
`add-vibefeld-adversarial-review` non-goal "Do not change … OpenCode overlays"
and the plan's no-agent wording, and only for one hidden, unpersisted agent
inside the extension-owned server's in-memory configuration. Every other
predecessor non-goal and plan decision remains binding: no user-visible or
persisted `vibefeld-prover`/`vibefeld-verifier` agents, task targets, plugins,
MCP servers, or custom tools; no `IAgent`, `packages/core`, or webview-protocol
change; no global `opencode.json`, profile, workspace, or TUI change; no
response gating; no automatic routing invoked by this capability; no AF
operation change; no persisted review traces; no truth, source-verification, or
formal-proof claim.

Additional boundaries: no second or plugin-free server instance is introduced —
host-configured plugins and MCP servers remain trusted host extensions in the
same extension-owned server process, and this change's denial claim covers the
restricted agent's model-callable authority only. On the current host (whose
claim capability is a constant `supported: true`) the adversarial selection
branch is dormant by construction and serves hosts/builds without claim
projection; composing claim projection with adversarial stages remains the
recorded follow-up decision.

## Capabilities

### New Capabilities

- `vibefeld-restricted-contexts`: hidden restricted child-context provider with a
  configuration-verified, generation-bound readiness preflight,
  provenance-distinct bounded stages, a host-side hidden-session registry and
  unretained lifecycle, and a gated live proof.

### Modified Capabilities

- `vibefeld-adversarial-review`: the capability requirement and the manual
  selection scenarios now permit the host-owned restricted provider path and its
  readiness gate, with claim projection retaining selection precedence and
  automatic routing excluded.

## Impact

- Affected code: `packages/agents/opencode/src/launch-config.ts` and the
  `buildChatOverlay` consumer in `opencode-agent.ts` (overlay field plus hidden
  session filtering in the session mapping), a new agent-package
  restricted-context provider module plus its `index.ts` export,
  `packages/platforms/vscode/src/vibefeld/` (new adapter, controller wiring for
  the explicit total timeout, and selection), and
  `packages/platforms/vscode/src/extension.ts` (selection and awaited
  deactivation only), with focused tests.
- Affected behavior: on a host without the claim capability, a manual
  post-response review runs one prover and one verifier child stage and publishes
  the existing bounded summary; hosts with claim projection keep that selection;
  otherwise the bounded unavailable behavior is unchanged.
- Compatibility: no core, protocol, or webview change; the existing review card
  and `ReasoningReviewSummary` are reused; ordinary Chat, Write, Scout, worker,
  MCP, sandbox, and TUI behavior are unchanged.
- Risks and fallback: if the overlay semantics or the configuration read-back do
  not hold on a given server build, the provider stays dormant/unavailable and no
  child context is created; the gated live proof is this change's enablement
  evidence while the runtime gate remains the generation-bound configuration
  check.
