## Context

The Vibefeld pipeline exists as six completed changes: provider-neutral review contracts, AF fixture evidence, the runtime bridge with proof storage and a policy seam, claim projection, an adversarial-review contract, a fixture-only response gate, and an automatic-routing policy/evaluation contract. Every piece is host-private and tested, but `extension.ts` still hard-constructs `UnavailableReasoningReviewController`, no production code supplies an `AfExecutionPolicyAdapter`, the output parsers accept only the repository fixture schema, no discovery or proof-store construction exists, no preference surface exists, and no qualified evaluation is supplied. The remaining work is activation: turn the pipeline on when every prerequisite is proven and leave ordinary Chat and Write unchanged otherwise.

The 2026-09-21 decisions close the previously open questions: the response gate is dismissed, adversarial review is deferred to a separate change, automatic routing is folded into activation, Hindsight stays an offline developer aid, and AF executes directly as a bounded child process under the user's existing enclosing sandbox with no AF nono profile or second sandbox.

## Goals / Non-Goals

**Goals:**

- Discover the host-owned AF runtime under a format-pinned, version-tolerant compatibility contract with fail-closed dormancy on absence, mismatch, or unsupported platform.
- Provide the production macOS/Linux `AfExecutionPolicyAdapter` as direct execution with fixed host-owned argv, `shell: false`, an allowlisted environment, bounded I/O, terminate-and-reap, and no profile selection or nested sandbox.
- Derive live output parsers from sanitized real captures while retaining the fixture-schema parser as an explicit test double.
- Compose the bridge and proof store in `extension.ts`, preflight once, select the review controller dynamically, and publish bounded runtime status.
- Gate the preference on availability at the Global target with a per-workspace opt-out and no non-functional control.
- Enable automatic routing from a validated qualified evaluation through the existing fail-closed policy and bounded rationale.
- Add the hybrid qualification pipeline with a versioned adjudicated seed corpus and host-private aggregate live capture.
- Amend security-negative requirements only via explicit MODIFIED requirements, permitting the constrained wiring and retaining every broader-authority prohibition.

**Non-Goals:**

- Response gating, buffering, draft/review/release, or any change to live streaming.
- Adversarial `vibefeld-prover`/`vibefeld-verifier` agents, tools, plugins, or restricted child-model contexts.
- Hindsight runtime calls, automatic ingestion of review content into memory, or Hindsight as a routing input.
- Scribe creating, editing, or promoting nono profiles; an AF profile, promotion flow, runtime grants, or a second sandbox; Windows policy support; model-visible AF; arbitrary argv.
- Changes to `packages/core` beyond the existing bounded routing metadata, to `IAgent`, to the OpenCode SDK adapter, or to the independent TUI and global OpenCode configuration.

## Decisions

### 1. Activation is an additive composition change at the extension host

All new wiring stays inside `packages/platforms/vscode` (private files plus `extension.ts` composition and the existing `ChatViewProvider` injection seam). `packages/core`, `IAgent`, the OpenCode SDK adapter, plugin/MCP configuration, Scout/Write permissions, and the Chat sandbox policy are untouched. The dynamic controller replaces only the fixed `UnavailableReasoningReviewController` construction.

**Alternative considered:** a new activation package or an `IAgent` method. Rejected because it would move AF naming into shared contracts and widen the model-visible boundary.

### 2. Discovery is fixed-candidate plus `PATH`, format-pinned and version-tolerant, dormant by default

Discovery resolves only the host-owned executable from fixed candidate locations plus `PATH` and validates a format-pinned, version-tolerant compatibility contract: an `af` version matching `^0\.1\.\d{1,3}$` (the 0.1.x line), `format` exactly `"1.1"`, and all required version fields present, bounded (at most 256 characters each), and safe. It records `version`, `commit`, `format`, and `policy` as host-private `{ version, commit, format, policy }` compatibility metadata but never exact-matches `version`, `commit`, `build_date`, `go_version`, or `policy`, so a commit or build bump inside a valid `format` does not force dormancy. Platform and architecture are host-derived from `process.platform` (`darwin`/`linux`) and `process.arch` (`arm64`/`x64`/`arm`/`ia32`); real AF JSON exposes no OS or architecture field and the host does not expect one. Missing, malformed, oversized, unsafe, ambiguous, or non-owned evidence and unsupported platforms classify as dormant `unavailable`; a version outside 0.1.x or a `format` other than `"1.1"` classifies as dormant `incompatible`. No model, prompt, plugin, or webview input can supply an executable, path, environment, or argv.

The earlier 0.1.7 / `5a37413` / workspace format `1.0` evidence was stale: real captures taken 2026-09-21 report `af` 0.1.11, commit `611291b`, format `1.1`, policy `0.1.9`, build `2026-09-21T00:24:48Z`, go `go1.27.1`. The synthetic `af-runtime-fixture-1` envelope never matched any real output and is retired to explicit test-double status; the sanitized real captures are the live-shape reference.

**Trade-off:** users with an unusual install location stay dormant, and a non-`1.1` format still fails closed. Tolerance for 0.1.x version and commit bumps trades a narrower identity pin for compatibility with AF's active development, while the `format` and field-shape contract stays strict and every compatibility failure is dormant.

### 3. AF executes directly as a bounded child process with no nested sandbox

The adapter reports readiness `{ state: "ready", execution: "direct" }` as soon as a compatible AF executable is resolved on a supported platform, and `unavailable`/`ambiguous` otherwise. It crosses the execution boundary with the descriptor `{ executable, argv, cwd }` and runs AF directly as a bounded child process of the extension host: fixed host-owned argv, `shell: false`, a detached process group, an allowlisted environment, bounded stdin/stdout/stderr, and terminate-and-reap. It selects no nono profile, invokes no nono binary, requests no runtime grants, enforces no denied domains, and verifies no policy audit. The user's enclosing session sandbox, if any, is the only sandbox, and direct execution is the only path, so there is no sandboxed variant to retry outside of. The Chat sandbox policy is never reused, reconfigured, or queried as an AF boundary.

Rationale: nested nono profiles do not work reliably on macOS, and the user already owns the enclosing sandbox for the whole session, so re-sandboxing AF inside Scribe adds complexity without a defensible guarantee. The KISS directive removes the AF profile, the profile-selection and promotion flow, runtime grants, and the denied-domain attestations. If AF needs additional allows under the user's nono profile, the standard nono skill flow (`nono why` plus a drafted profile promotion) handles it outside Scribe. The proof workspace remains only AF's working directory for review scratch; the "AF sees only the ephemeral proof workspace" isolation guarantee is withdrawn as a design goal.

**Alternatives considered:** a documented AF nono profile promoted once by the user (rejected: nesting and profile plumbing add KISS-violating complexity, and the guarantee was not enforceable on macOS); bundling and auto-promoting a profile (rejected: Scribe must not mutate nono profiles); reusing the Chat sandbox as a substitute (rejected: it remains the wrong boundary and is never queried); accepting an arbitrary user profile without validation (rejected: it could not prove the promised domains anyway, and no domains are claimed now).

### 4. Live parsing is mode-selected and never accepts fixture-shaped evidence

Sanitized real captures of the 2026-09-21 shapes become the versioned live-shape reference from which the live parsers are derived. `af version --json` is a flat `{ version, commit, build_date, go_version, format, policy }` object; `af schema --format json` returns the six arrays `inference_types`, `node_types`, `workflow_states`, `epistemic_states`, `taint_states`, and `challenge_targets`, normalized to bounded section counts or key sums; `af init -c <conjecture> -a <author> -d <dir>` returns prose only (there is no JSON mode), normalizes a success exit to `{ initialized: true }`, and its workspace path is discarded and never stored; `af status -d <dir> --format json` returns statistics, jobs, node, and challenge structures normalized to bounded numeric aggregates and counts only — no node statements, ledger content, or challenge content. Platform and architecture are host-derived, never parsed from AF output. The fixture-schema parser, including the retired `af-runtime-fixture-1` envelope, remains the explicit test double; the two parsers stay separate and are selected by an explicit mode; live mode rejects fixture schema markers, placeholders, and fixture workspace identities, and fixture mode is never production evidence. A gated capture harness (explicit opt-in, project-relative sanitized output) produces new captures without becoming a default test dependency.

**Trade-off:** parser duplication is intentional. A single lenient parser could silently promote fixture data into production runtime evidence.

### 5. The preference is availability-gated, Global-target, with workspace opt-out

The preference is stored at the Global target; effective enablement is `userEnabled && runtime available` through direct execution, and a workspace may opt out. The `ToolConfigPanel` control renders only when the runtime is available; otherwise no control renders. All new labels, status text, and accessibility strings land in every webview locale dictionary.

**Alternative considered:** always render a disabled control. Rejected because it advertises a capability that may not exist and can mislead users about AF availability.

### 6. Automatic routing is enabled by qualification, not by a separate toggle

Activation injects the evaluation and enable flag. Selection remains fail-closed: no selection unless the existing qualification validator reports the evaluation qualified, the runtime is available, the enable flag is set with policy signals passing, and the existing router selects. Thresholds, work-mode exclusions, duplicate suppression, post-response semantics, and bounded rationale rendering are unchanged; automatic review never gates, delays, or rewrites the response.

**Alternative considered:** a dedicated automatic-routing toggle. Rejected for this phase because qualification is the meaningful gate and a toggle would imply control over an unmeasured capability.

### 7. Qualification is hybrid and host-private

A versioned, adjudicated seed corpus of 30–50 cases (repository artifact) validates the pipeline end to end through the existing measurement and qualification path. Host-private live capture then accumulates to the existing 100-case minimum: latency is recorded automatically, `challenged` is derived from review status, and `correct`/`falseChallenge` come only from bounded local review-card feedback. Aggregates contain no prompts, source packets, review text, response text, or paths, and there is no Hindsight or memory-provider runtime coupling. Opt-out and disable are the escape hatches.

**Alternative considered:** qualify from the seed corpus alone (rejected: 30–50 cases cannot meet the 100-case minimum); collect free-form feedback (rejected: unbounded and privacy-sensitive).

### 8. The dismissed and deferred capabilities stay prohibited

The response gate remains a fixture-level contract and is never activated; no gate change is created. Adversarial review moves to `add-vibefeld-restricted-contexts`, created only after activation proves useful and requiring its own security review for a restricted tool-less child-model context. Hindsight remains an offline developer research aid. The security-negative suites are amended only through the explicit MODIFIED requirements in this change, which permit the constrained wiring while retaining prohibitions on plugins, MCP, custom tools, agent overlays, `IAgent`/protocol AF fields, arbitrary argv, nono invocation, profile writes, and nested sandboxes.

### 9. Dormancy and failure semantics are nonfatal and side-effect free

When AF is absent, incompatible, or unsupported, or direct execution readiness is unavailable, activation performs at most one bounded, nonfatal preflight, injects `UnavailableReasoningReviewController`, publishes the matching runtime status, launches no process, creates no proof workspace, renders no control, and records no aggregate. There is no per-message discovery or preflight.

## Risks / Trade-offs

- **[Discovery could activate against an unexpected binary]** → Fixed candidate resolution, host-owned resolution, the strict `format`/field-shape contract, and dormant classification on any mismatch.
- **[AF version drift could force dormancy or admit an unknown runtime]** → The contract is format-pinned and version-tolerant: any bounded, safe 0.1.x version reporting `format` `"1.1"` activates, while `version`/`commit`/`build_date`/`go_version`/`policy` are recorded as host-private metadata and never exact-matched; a version outside 0.1.x or a non-`1.1` format stays dormant as `incompatible`.
- **[Direct execution could be mistaken for an enforced isolation boundary]** → The adapter claims no isolation guarantee, invokes no nono, selects no profile, and creates no nested sandbox; readiness follows only compatibility and a valid fixed executable; the Chat sandbox is never reused as an AF boundary.
- **[Live parsers could drift from the real CLI]** → Capture-derived live-shape reference, explicit mode selection, host-derived platform, path discarding, aggregate-only status facts, fixture-shaped output rejection, and bounded upgrade/audit-failed classification.
- **[Default-on could surprise users]** → Availability gating, workspace opt-out, no control when unavailable, and unchanged manual/unavailable fallback.
- **[Routing could over-select or be mistaken for gating]** → Qualification remains the enablement gate, thresholds and exclusions unchanged, bounded rationale visible, post-response only, no release transaction.
- **[Qualification could leak or over-fit]** → Aggregate-only host-private recording, adjudicated seed corpus, bounded review-card feedback, escape hatches, and no memory-provider coupling.
- **[MODIFIED deltas target capability specs that are still change-local]** → All six predecessor changes are complete but not archived; archiving must sync those capability specs before or with this change so the MODIFIED requirements resolve. Until then, strict validation reports the archive-order note and the deltas remain valid.

## Migration Plan

1. Land discovery and the compatibility preflight first; the extension remains dormant because no execution adapter or composition exists yet.
2. Land the direct-execution adapter with injected seams; default tests never require a real nono installation or profile.
3. Land live parsers, sanitized captures, and the gated capture harness while the fixture parser remains the default test double.
4. Compose the bridge, proof store, and dynamic controller selection in `extension.ts`; verify ordinary Chat and Write are byte-for-byte unchanged when dormant.
5. Add the Global-target preference, workspace opt-out, availability-gated control, and locale keys.
6. Inject the qualified evaluation and enable flag; verify fail-closed routing.
7. Add the hybrid qualification pipeline, seed corpus artifact, and escape hatches.
8. Amend the security-negative requirements and tests in the same change so no intermediate state permits broader authority.
9. Run focused suites, `pnpm run check`, `pnpm run build`, `pnpm run test:all`, `openspec validate add-vibefeld-activation --strict`, and `git diff --check`.

## Rollback

Rollback removes the activation composition: revert `extension.ts` to constructing `UnavailableReasoningReviewController`, remove the preference, control, locale keys, evaluation injection, and live-capture recorder, and restore the security-negative assertions for dormancy. Discovery, policy, parser, proof-store, and qualification modules can remain as dormant, tested contracts; no predecessor change needs to be reverted, no nono profile or AF/OpenCode configuration is changed by the rollback, and ordinary Chat, Write, Scout, MCP, sandbox, and TUI behavior is unaffected.

## Open Questions

None. The 2026-09-21 decisions in `plans/vibefeld-scribe.md` resolve the previously open choices: response gate dismissed, adversarial review deferred, automatic routing folded into activation, Hindsight as an offline aid, and direct AF execution under the user's enclosing session sandbox with no AF profile, grant, or nested sandbox.
