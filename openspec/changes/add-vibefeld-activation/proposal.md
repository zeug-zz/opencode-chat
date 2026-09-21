## Why

The six Vibefeld pipeline changes are complete but dormant: `extension.ts` still constructs `UnavailableReasoningReviewController`, no production code supplies an `AfExecutionPolicyAdapter`, no discovery or proof store exists, and automatic routing has no qualified evaluation. The capability cannot become available to a user who has a compatible AF runtime. This change activates the pipeline only when every prerequisite is proven, and keeps ordinary Chat and Write unchanged when it is not.

## What Changes

- Add host-owned AF discovery over fixed candidate locations plus `PATH`; resolve only the host-owned executable and verify the format-pinned, version-tolerant compatibility contract (AF 0.1.x with format `1.1`) against sanitized live-shape captures, failing closed to dormant `unavailable` or `incompatible` on absence, mismatch, unsupported platform, or unreadable compatibility evidence.
- Add the production macOS/Linux `AfExecutionPolicyAdapter` as direct execution: readiness `{ state: "ready", execution: "direct" }` from a compatible executable, descriptor `{ executable, argv, cwd }`, fixed host-owned argv, `shell: false`, an allowlisted environment, bounded I/O, and terminate-and-reap. AF runs directly under the user's enclosing session sandbox with no nested nono profile or second sandbox; Scribe creates, edits, promotes, or selects no nono profile, requests no runtime grants, enforces no denied domains, verifies no policy audit, and never reuses the Chat sandbox policy.
- Add live output parsers derived from sanitized real `af version`, `schema`, `init`, and `status --json` captures. The fixture-schema parser remains the explicit test double; both parsers stay separate and mode-selected, and fixture-shaped output is never accepted as a live runtime.
- Compose activation in `extension.ts`: construct the bridge and proof store beneath `context.globalStorageUri`, preflight once per activation, inject `ClaimProjectionReasoningReviewController` when ready or `UnavailableReasoningReviewController` otherwise, and publish runtime status over the existing protocol.
- Add a Global-target preference with a per-workspace opt-out and an availability-gated `ToolConfigPanel` control; synchronized locale keys land in every dictionary, and no non-functional control is rendered when AF is absent or incompatible.
- Enable automatic routing only when the injected evaluation validates as qualified, the runtime is available, the enable flag is set, and policy signals pass, reusing the existing fail-closed policy, thresholds, and bounded rationale rendering.
- Add the hybrid qualification pipeline: a versioned 30–50 case adjudicated seed corpus artifact validates the pipeline, then host-private aggregate live capture accumulates reviews to the 100-case minimum, with latency recorded automatically, `challenged` derived from review status, and `correct`/`falseChallenge` collected only through bounded local review-card feedback.
- Amend the security-negative requirements only via explicit MODIFIED requirements so the constrained wiring is permitted while every prohibition on plugins, MCP, custom tools, agent overlays, `IAgent`/protocol AF fields, arbitrary argv, nono invocation, profile writes, and nested sandboxes is retained.
- No response gating, adversarial prover/verifier, Hindsight runtime call, nono invocation or profile write, nested sandbox, Windows policy support, model-visible AF, or TUI/global configuration change is introduced.

## Capabilities

### New Capabilities

- `vibefeld-activation`: Host-owned activation of the dormant Vibefeld reasoning-review pipeline — pinned AF discovery, a direct-execution production policy adapter, live output parsing, dynamic controller selection and runtime publication, availability-gated preference, qualified automatic routing, and a host-private hybrid qualification pipeline.

### Modified Capabilities

- `vibefeld-reasoning-review`: the scaffold authority-boundary requirement is amended to permit only the constrained activation wiring while retaining the no-runtime, no-plugin, no-MCP, no-tool, no-permission prohibitions for the scaffold contract itself.
- `vibefeld-runtime-contract`: the host-owned/model-authority, process-boundary, and contract-phase dormancy requirements are amended to direct execution, so a single documented discovery/preflight may run at activation with no profile, grant, denied-domain, or audit step, without exposing model-controlled execution or mutating profiles.
- `vibefeld-runtime-bridge`: the bridge dormancy requirement is amended so `extension.ts` may construct the bridge and proof store and preflight once, with the existing unavailable-controller fallback and all authority prohibitions retained.
- `vibefeld-claim-projection`: the projection dormancy requirement is amended so the claim-projection controller may be injected dynamically when the runtime is ready, with ordinary activation behavior unchanged when dormant.
- `vibefeld-automatic-routing`: the enablement requirement is amended so a validated qualified evaluation supplied by activation may enable selection without a separate user toggle, while the selection gates, thresholds, post-response semantics, and bounded rationale contract remain unchanged.

## Impact

- Affected platform code: new and existing private files under `packages/platforms/vscode/src/vibefeld/`, `extension.ts` composition, and the existing review-controller injection seam in `ChatViewProvider`.
- Affected settings and UI: `package.json` configuration for the Global-target preference, the existing `ToolConfigPanel`, and every webview locale dictionary.
- Affected tests: focused platform discovery/policy/parser/composition/settings/routing/qualification suites, extension-host integration tests, webview component and scenario tests, and the amended security-negative suites.
- Affected artifacts: versioned seed-corpus and sanitized capture fixtures committed as repo artifacts; `openspec/` change artifacts.
- Unchanged: `packages/core` provider-neutral types beyond existing bounded routing metadata, `IAgent`, the OpenCode SDK adapter, plugin/MCP configuration, Scout and Write permissions, the Chat sandbox policy, global OpenCode configuration, and the independent TUI.

## Non-Goals

- No response gating, buffering, or hold-before-release; post-response review remains the final semantics.
- No `vibefeld-prover`/`vibefeld-verifier` agents, tools, plugins, or restricted child-model contexts.
- No Hindsight runtime call, automatic ingestion of review content into memory, or Hindsight routing input.
- No Scribe creation, editing, promotion, or selection of nono profiles; no AF profile, promotion flow, runtime grants, or second sandbox.
- No Windows policy support; unsupported platforms stay dormant.
- No model-visible AF route, `IAgent`/protocol AF fields, arbitrary argv, or nested sandbox.
- No changes to the independent OpenCode TUI or global OpenCode configuration.

## Risks and Fallback

Discovery or identity drift could activate against an unexpected binary; the pinned fixture check and fail-closed dormancy prevent execution. Direct execution could be mistaken for an enforced isolation boundary; `readiness` is only `ready` from resolved compatibility and a valid executable, no isolation guarantee is claimed, no nested sandbox is created, and the runtime stays dormant otherwise. Live parsers could drift from the captured contract; the mode-selected live parser rejects fixture-shaped output and malformed captures downgrade to `unavailable` or `audit_failed`. The settings surface could promise a capability that is not ready; the control is availability-gated and never rendered without a ready runtime and policy. Qualification could over-fit the seed corpus; the pipeline requires adjudicated cases and continues accumulating host-private live outcomes to the 100-case minimum. Fallback in every failure mode is the existing `UnavailableReasoningReviewController` with unchanged ordinary Chat and Write behavior.

## Compatibility Impact

When AF is absent, incompatible, unsupported, or direct execution readiness is unavailable, the extension behaves exactly as today: the unavailable controller is injected, no process is discovered, no proof workspace is written, no setting control is rendered, and no automatic review is selected. Existing manual review, protocol messages, summaries, response-gate fixtures, adversarial fixtures, Scout delegation, worker permissions, MCP policy, Chat sandbox, and OpenCode configuration remain unchanged. The constrained wiring is reflected only by the explicitly modified security-negative requirements; all broader-authority prohibitions remain in force.
