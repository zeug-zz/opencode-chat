## Purpose

Activate the dormant Vibefeld reasoning-review pipeline only for a host that resolves a compatible AF runtime under a format-pinned, version-tolerant contract and direct execution readiness, and keep the extension dormant and ordinary Chat and Write unchanged everywhere else.

## ADDED Requirements

### Requirement: Discover only a host-owned compatible AF runtime and fail closed to dormancy

The host SHALL resolve the AF executable from fixed candidate locations plus `PATH` only, SHALL resolve only the host-owned executable, and SHALL verify a format-pinned, version-tolerant compatibility contract against the live `af version --json` result before reporting an available runtime: a supported version matching `^0\.1\.\d{1,3}$` (the 0.1.x line), a `format` field exactly `"1.1"`, and every required version field present, bounded (at most 256 characters each), and safe. The host SHALL record `version`, `commit`, `format`, and `policy` as host-private compatibility metadata but MUST NOT exact-match `version`, `commit`, `build_date`, `go_version`, or `policy`; exact commit equality MUST NOT gate support. Platform and architecture SHALL be host-derived from `process.platform` (`darwin` or `linux`) and `process.arch` (`arm64`, `x64`, `arm`, or `ia32`); real AF JSON exposes no OS or architecture field and the host MUST NOT expect one. Absence, ambiguity, a non-executable or non-owned candidate, missing, malformed, oversized, or unsafe version fields, unsupported platform or architecture MUST produce a dormant `unavailable` runtime state, and a version outside the 0.1.x line or a `format` other than `"1.1"` MUST produce a dormant `incompatible` runtime state, in every case without spawning AF, creating a proof workspace, writing configuration, or changing ordinary Chat and Write behavior.

#### Scenario: A compatible host-owned runtime is present

- **WHEN** discovery resolves a host-owned executable whose bounded version result reports a 0.1.x version and `format` `"1.1"`
- **THEN** the host SHALL report availability once the runtime is compatible and direct execution readiness is present
- **AND** it SHALL keep the resolved executable path, raw output, and preflight evidence host-private
- **AND** it SHALL record the observed `version`, `commit`, `format`, and `policy` as host-private compatibility metadata without requiring exact commit equality

#### Scenario: Runtime compatibility cannot be established

- **WHEN** the resolved executable is missing, ambiguous, or not host-owned, reports a version outside the 0.1.x line or a `format` other than `"1.1"`, or reports a missing, malformed, oversized, or unsafe required field
- **THEN** the host SHALL report `incompatible` for the version or format failure and `unavailable` for the missing, malformed, oversized, unsafe, ambiguous, or non-owned failure
- **AND** it SHALL not spawn AF, allocate a proof workspace, or fall back to another executable

#### Scenario: Unsupported platform stays dormant

- **WHEN** the host-derived `process.platform` or `process.arch` falls outside the supported sets (including Windows)
- **THEN** activation SHALL remain dormant as `unavailable` without a process launch, proof workspace, or availability claim
- **AND** no AF output field SHALL be read as an OS or architecture selector
- **AND** ordinary Chat and Write behavior SHALL remain unchanged

#### Scenario: Model or user input cannot select a runtime

- **WHEN** a model, prompt, plugin, MCP server, or user message supplies an executable, path, environment, or argv value for discovery
- **THEN** discovery SHALL ignore that input
- **AND** only the fixed host-owned candidate resolution SHALL select the executable

### Requirement: Provide a direct-execution policy adapter without a nested sandbox

The production adapter SHALL implement the existing `AfExecutionPolicyAdapter` contract for macOS and Linux and SHALL report readiness `{ state: "ready", execution: "direct" }` whenever a compatible AF executable is resolved on a supported platform. It MUST run AF directly as a child process of the extension host, under whatever enclosing sandbox the user's session already has, with the fixed host-owned argv, `shell: false`, a detached process group, an allowlisted environment, and bounded stdin/stdout/stderr, and it MUST terminate and reap AF on completion, cancellation, timeout, or teardown. It MUST NOT create, join, or delegate to a nested sandbox: the adapter MUST NOT resolve or invoke `nono`, select, persist, or promote a profile, request runtime grants, enforce denied domains, or verify a policy audit. Direct execution is the only execution path, so no alternate execution or retry variant exists, and the adapter MUST NOT reuse, reconfigure, or query the Chat sandbox policy. Scribe SHALL remain dormant as `unavailable` on an unsupported platform or when no compatible executable is resolved, and MAY report `ambiguous` only when the execution facts are ambiguous.

#### Scenario: Direct execution readiness on a supported host

- **WHEN** a compatible AF executable is resolved on macOS or Linux
- **THEN** the adapter SHALL report readiness `{ state: "ready", execution: "direct" }`
- **AND** it SHALL execute with the fixed host-owned argv, `shell: false`, an allowlisted environment, and bounded stdin/stdout/stderr without selecting a profile or requesting a grant

#### Scenario: No nested sandbox or nono invocation

- **WHEN** the adapter launches, preflights, or tears down AF
- **THEN** AF SHALL run directly as a bounded child process under the user's enclosing session sandbox
- **AND** no `nono` binary, profile flag, wrapper, or second sandbox SHALL be invoked, selected, or written

#### Scenario: Execution is terminated and reaped

- **WHEN** AF completes, is cancelled, times out, or fails
- **THEN** the adapter SHALL terminate and reap AF and SHALL expose only bounded output
- **AND** it SHALL NOT weaken the fixed argv or environment and SHALL NOT retry outside the direct execution path

#### Scenario: Direct execution readiness is unavailable

- **WHEN** the platform is unsupported or no compatible executable is resolved
- **THEN** the adapter SHALL report `unavailable`, or `ambiguous` when the execution facts are ambiguous
- **AND** no process SHALL launch, no sandbox or profile SHALL be created, and no configuration SHALL be written

#### Scenario: Only the Chat sandbox exists

- **WHEN** the extension can provide its existing Chat sandbox
- **THEN** the adapter SHALL not reuse, reconfigure, reset, or query Chat's sandbox policy as an AF boundary
- **AND** AF SHALL continue to run directly under the user's enclosing session sandbox

### Requirement: Parse live AF output separately from the fixture test double

The host SHALL derive the live output parsers from sanitized real `af version --json`, `af schema --format json`, `af init`, and `af status --format json` captures and SHALL keep the fixture-schema parser as an explicit test double. The two parsers MUST remain separate and MUST be selected by an explicit mode; live mode MUST NOT accept fixture-shaped output (fixture schema markers, fixture placeholder values, or fixture workspace identities) as a live runtime, and fixture mode MUST NOT be used as production evidence. The live version parser SHALL read the flat `{ version, commit, build_date, go_version, format, policy }` object. The live schema parser SHALL read the six arrays `inference_types`, `node_types`, `workflow_states`, `epistemic_states`, `taint_states`, and `challenge_targets`, and SHALL expose bounded section counts or key sums only. The live init parser SHALL treat `af init -c <conjecture> -a <author> -d <dir>` prose output as having no JSON mode, SHALL normalize a success exit to `{ initialized: true }`, and MUST discard any workspace path contained in the prose and never store it. The live status parser SHALL read `{ statistics { total_nodes, epistemic_state {}, taint_state {}, total_challenges, open_challenges }, jobs { prover_jobs, verifier_jobs }, nodes [], challenges [] }` and SHALL normalize bounded numeric aggregates and counts only, never node statements, ledger content, or challenge content. Platform and architecture SHALL be host-derived from `process.platform` and `process.arch`, never parsed from AF output. Malformed, oversized, empty, unauthorized, or exit-failure output MUST map to a bounded unavailable, incompatible, or audit-failed result without publishing raw output.

#### Scenario: Live captures drive the live parsers

- **WHEN** the host parses a sanitized real capture from a compatible runtime
- **THEN** the live parser SHALL produce the normalized host-private facts for the requested operation: flat version fields, bounded schema section counts, `{ initialized: true }` for a success init exit, or bounded numeric status aggregates
- **AND** it SHALL not expose raw output, workspace paths, ledger content, node or challenge content, or a structural claim

#### Scenario: Init and status parsers discard content

- **WHEN** an init capture contains a workspace path in prose or a status capture contains node or challenge arrays
- **THEN** the normalized facts SHALL contain no path and only bounded counts and numeric aggregates
- **AND** the raw prose, node statements, ledger content, and challenge content SHALL never be stored or published

#### Scenario: Fixture-shaped output reaches live mode

- **WHEN** live-mode parsing receives fixture schema markers, fixture placeholders, or a fixture workspace identity
- **THEN** the parser SHALL reject it as a live runtime result
- **AND** the runtime SHALL remain unavailable or incompatible without retrying under the fixture parser

#### Scenario: A parser mode is mismatched or absent

- **WHEN** a caller supplies no explicit mode or selects the fixture parser in a production path
- **THEN** parsing SHALL fail closed as unavailable
- **AND** no fixture result SHALL be promoted to production runtime evidence

### Requirement: Compose activation once in the extension host and publish runtime state

`extension.ts` SHALL construct the runtime bridge and the proof store beneath `context.globalStorageUri`, SHALL preflight the bridge at most once per extension activation, and SHALL inject `ClaimProjectionReasoningReviewController` only when the runtime is ready and the bridge reports an explicitly supported claim operation. When direct execution is ready but the bridge reports no supported claim operation, the host SHALL inject `UnavailableReasoningReviewController` and publish the bounded `{ state: "unavailable", reason: "claim-capability-unavailable" }` status without compiling a claim graph or claiming availability. The host SHALL publish the existing bounded runtime status so the review card distinguishes `unavailable`, `checking`, `incompatible`, and `available`, and MUST NOT publish `available` without a supported claim operation. When the runtime is dormant, ordinary Chat, Write, Scout, worker, MCP, sandbox, and TUI behavior MUST remain unchanged, no per-message discovery or preflight may occur, and an activation failure MUST be nonfatal.

#### Scenario: A ready runtime with a supported claim capability selects the projection controller

- **WHEN** discovery, the compatibility contract, direct execution readiness, the storage preflight, and an explicitly supported claim operation all succeed during extension activation
- **THEN** the host SHALL inject `ClaimProjectionReasoningReviewController` and publish an available runtime status
- **AND** manual review requests SHALL use the existing bounded source-packet and publication paths

#### Scenario: A compatible runtime without claim projection stays review-unavailable

- **WHEN** discovery, the compatibility contract, direct execution readiness, and the storage preflight succeed but the bridge reports no supported claim operation
- **THEN** the host SHALL inject `UnavailableReasoningReviewController` and publish the bounded `{ state: "unavailable", reason: "claim-capability-unavailable" }` status
- **AND** no claim graph SHALL compile, no claim operation SHALL run, no review affordance SHALL render, automatic routing SHALL stay inactive, and no qualification evidence SHALL be recorded

#### Scenario: A dormant runtime keeps the unavailable controller

- **WHEN** AF is absent, incompatible, or unsupported, or direct execution readiness is unavailable
- **THEN** the host SHALL inject `UnavailableReasoningReviewController` and publish the matching bounded status
- **AND** no process SHALL launch, no proof workspace SHALL be created, and ordinary Chat and Write SHALL behave exactly as before

#### Scenario: Preflight runs at most once per activation

- **WHEN** multiple manual review requests, session switches, or ordinary messages occur during one activation
- **THEN** discovery and preflight SHALL NOT run again for ordinary messages
- **AND** runtime status SHALL be reused until the extension deactivates

### Requirement: Gate the review preference on availability and preserve workspace opt-out

The reasoning-review preference SHALL be stored through VS Code configuration at the Global target and SHALL support a per-workspace opt-out. Its effective state SHALL be enabled only when the user preference is enabled and the runtime is `available` through direct execution. An availability-gated `ToolConfigPanel` control MAY be rendered only when the runtime is available; an absent or incompatible runtime MUST NOT render a non-functional control. Every user-facing label, unavailable message, and accessibility text added by this change SHALL have entries in every webview locale dictionary.

#### Scenario: Available runtime renders a functional control

- **WHEN** the runtime is available through direct execution and the review preference is enabled by default
- **THEN** the settings control SHALL render and reflect the effective enabled state
- **AND** a workspace SHALL be able to opt out without changing the Global preference

#### Scenario: Unavailable runtime renders no control

- **WHEN** AF is absent, incompatible, or unsupported, or direct execution readiness is unavailable
- **THEN** the settings control SHALL NOT render
- **AND** no non-functional control, misleading status, or configuration write SHALL occur

#### Scenario: Every locale provides the new labels

- **WHEN** the control or runtime status renders under any supported locale
- **THEN** it SHALL use translated keys and bounded text
- **AND** no unlocalized key SHALL reach the user

### Requirement: Gate the per-message review affordance on availability and toggle the review result

The per-message review affordance SHALL render only for a completed assistant message while the review runtime is `available`. When the runtime is absent, `unavailable`, `checking`, or `incompatible`, the affordance MUST NOT render and MUST NOT be replaced by a non-functional control. When a completed review summary exists, the affordance SHALL toggle the result card open and closed instead of starting another review: it SHALL present a hide action while the card is open and a show action while the card is collapsed, SHALL NOT start, repeat, or refresh a review when toggled, and SHALL expose the expanded or collapsed state to assistive technology. While a review is in flight, the affordance SHALL remain the existing cancel action. Every label added for the toggle SHALL exist in every webview locale dictionary.

#### Scenario: A dormant or incompatible runtime renders no affordance

- **WHEN** a completed assistant message is displayed while the runtime is absent, `unavailable`, `checking`, or `incompatible`
- **THEN** no per-message review affordance SHALL render
- **AND** the host SHALL receive no review request from the message

#### Scenario: A completed review toggles without another review

- **WHEN** a review summary is displayed and the user activates the affordance
- **THEN** the card SHALL collapse and the host SHALL receive no new review request
- **AND** activating the affordance again SHALL expand the existing summary without starting, repeating, or refreshing the review

#### Scenario: An in-flight review keeps the cancel action

- **WHEN** a review is in flight for the message
- **THEN** the affordance SHALL remain the existing cancel action
- **AND** SHALL NOT offer the open/close toggle until the review completes or is cancelled

### Requirement: Enable automatic routing only from a validated qualified evaluation

Automatic routing SHALL remain fail-closed. The host MUST NOT select an automatic review unless the injected evaluation is reported qualified by the existing qualification validator, the review runtime is available, the enable flag is set with policy signals passing, and the existing selection policy returns a selection. The existing thresholds, work-mode exclusions, post-response semantics, duplicate suppression, and bounded rationale contract MUST remain unchanged. Automatic routing MUST never withhold, rewrite, or release the original response.

#### Scenario: A qualified evaluation enables selection

- **WHEN** activation supplies a qualified evaluation, the runtime is available, the enable flag is set, and the existing policy signals select an eligible response
- **THEN** the host SHALL make at most one post-response automatic review request with the existing bounded rationale
- **AND** the original response SHALL remain published unchanged

#### Scenario: Unqualified or stale evaluation produces no selection

- **WHEN** the evaluation is missing, stale, malformed, non-finite, below the case minimum, or above a target
- **THEN** the host SHALL make no automatic selection and invoke no review controller
- **AND** it SHALL not retry with weaker thresholds or enable routing without a qualified result

#### Scenario: Prior routing behavior is preserved

- **WHEN** automatic routing is considered for an ordinary, incomplete, inactive-session, duplicate, or manually reviewed response
- **THEN** the existing non-selection reasons SHALL apply unchanged
- **AND** no response-gate, child-model, plugin, MCP, or nested-sandbox path SHALL be involved

### Requirement: Qualify with a hybrid host-private aggregate pipeline

Qualification SHALL use a versioned adjudicated seed corpus of 30–50 cases, committed as a repository artifact, to validate the pipeline, and SHALL then accumulate host-private live outcome capture to the existing 100-case minimum before reporting qualified. Every qualification aggregate MUST remain host-private and MUST NOT contain prompts, source packets, review text, response text, or paths. Live capture SHALL record latency automatically, SHALL derive `challenged` from the review status, and SHALL collect `correct` and `falseChallenge` only through a bounded local review-card feedback control. The pipeline MUST NOT call Hindsight or any memory provider at runtime, MUST NOT automatically ingest review content into memory, and MUST provide escape hatches that disable recording and automatic routing.

#### Scenario: The seed corpus validates the pipeline

- **WHEN** the versioned 30–50 case adjudicated seed corpus runs through the measurement and qualification path
- **THEN** the pipeline SHALL produce aggregate-only metrics accepted by the existing qualification validator
- **AND** the corpus SHALL contain no user content, paths, prompts, or review text

#### Scenario: Live capture accumulates to the case minimum

- **WHEN** reviews complete on a host with a ready runtime
- **THEN** latency SHALL be recorded automatically, `challenged` SHALL be derived from the review status, and `correct`/`falseChallenge` SHALL be collected only from bounded local review-card feedback
- **AND** qualification SHALL be reported no earlier than the existing 100-case minimum

#### Scenario: Aggregates stay host-private and uncoupled

- **WHEN** aggregates are recorded, stored, or validated
- **THEN** they SHALL contain only version, corpus identity, case count, and aggregate metrics
- **AND** no prompt, source packet, review text, path, or memory-provider call SHALL be involved

#### Scenario: Escape hatches disable accumulation

- **WHEN** the user opts out for the workspace or disables reasoning review
- **THEN** live capture and automatic routing SHALL stop
- **AND** no further aggregate SHALL be recorded until the user enables the capability again

### Requirement: Retain every model-visible and broader-authority prohibition

Activation SHALL permit only the constrained wiring: host-owned discovery, direct execution, mode-selected live parsers, proof storage beneath extension global storage, one preflight, dynamic controller selection, the availability-gated preference, and the qualified routing and qualification paths. AF MUST NOT be added as an OpenCode plugin, `pluginSources` entry, MCP server, custom tool, agent overlay, or task target; `IAgent` and the webview protocol MUST NOT gain AF fields; and callers MUST NOT supply arbitrary argv, executable paths, workspaces, or environment overrides. No response gate, adversarial prover/verifier, restricted child-model context, Hindsight runtime call, Windows policy, model-visible AF, nono invocation or profile mutation, nested sandbox, or TUI/global configuration change SHALL be introduced. Security-negative tests SHALL be amended only through the explicit MODIFIED requirements carried by this change, and every retained prohibition SHALL keep failing closed under test.

#### Scenario: Broader authority surfaces stay absent

- **WHEN** the activation wiring is inspected in extension, agent, launch configuration, plugin, and MCP sources
- **THEN** plugin sources, MCP entries, custom tools, agent overlays, and `IAgent`/protocol AF fields SHALL remain absent
- **AND** no arbitrary argv, executable, workspace, or environment input SHALL be reachable from a model or webview

#### Scenario: Deferred capabilities remain unactivated

- **WHEN** the extension activates with a ready runtime
- **THEN** the response gate SHALL remain a fixture-level contract, adversarial review SHALL remain deferred, and no prover/verifier agent, tool, or plugin SHALL exist
- **AND** Hindsight SHALL remain an offline developer aid with no runtime routing or ingestion path

#### Scenario: Security negatives fail closed on attempted widening

- **WHEN** the amended security-negative suites run
- **THEN** they SHALL permit only the constrained wiring and SHALL fail on any plugin, MCP, custom-tool, agent-overlay, permission, nested-sandbox, nono-invocation, or arbitrary-argv widening
- **AND** ordinary Chat, Write, Scout, worker, sandbox, and TUI boundaries SHALL remain pinned
