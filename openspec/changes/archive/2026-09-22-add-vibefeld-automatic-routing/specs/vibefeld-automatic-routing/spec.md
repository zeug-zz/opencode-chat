## Purpose

Provides a bounded, host-owned and explicitly opt-in way to select eligible completed assistant responses for automatic post-response reasoning review without turning review into an unproven delivery gate.

## ADDED Requirements

### Requirement: Automatic review selection is explicitly enabled and fail-closed

The host SHALL select a response for automatic reasoning review only when automatic routing is explicitly enabled, the review runtime is `available`, the supplied evaluation is currently qualified, the response is a completed assistant message in the active session, and the response belongs to a supported Scribe work mode. Missing, stale, malformed, unavailable, incompatible, or conflicting prerequisites MUST produce a non-selection decision and MUST NOT invoke the review controller.

#### Scenario: Default-disabled routing preserves ordinary behavior
- **WHEN** automatic routing is disabled or no qualified evaluation is supplied
- **THEN** no automatic review is selected, no controller request is made, and ordinary Chat and Write behavior remains unchanged

#### Scenario: Available qualified routing selects an eligible response
- **WHEN** routing is enabled, the runtime is available, the evaluation is qualified, and a completed active-session response meets the routing policy
- **THEN** the host returns one automatic-selection decision with a bounded reason and may invoke the existing review controller after response delivery

#### Scenario: Unavailable runtime never routes
- **WHEN** routing is enabled but the runtime is unavailable or incompatible
- **THEN** the host returns a non-selection decision and does not invoke AF, a child model, a process, a plugin, an MCP server, or a response-release gate

#### Scenario: Ordinary work is excluded
- **WHEN** a request is classified as lookup, translation, creative work, coding/shell work, worker output, or an unsupported work mode
- **THEN** the response is not automatically selected, even if routing is enabled and evaluation evidence is qualified

### Requirement: Routing qualification uses bounded reviewed-corpus metrics

The system SHALL qualify automatic routing only from a versioned reviewed evaluation corpus containing at least 100 bounded cases and aggregate metrics with finite non-negative values. The initial qualification targets SHALL be p95 routing latency at or below 2,000 milliseconds, expected calibration error at or below 0.10, and false-challenge rate at or below 0.05. Raw case text, prompts, source packets, private reasoning, provider payloads, and per-case content MUST NOT be retained in the qualification result.

#### Scenario: A corpus meeting all targets qualifies
- **WHEN** a versioned corpus has at least 100 cases and all three aggregate metrics meet the targets
- **THEN** the evaluation is marked qualified and can be used by an explicitly enabled router

#### Scenario: A corpus missing a target remains unqualified
- **WHEN** the corpus is too small, a metric is non-finite or out of bounds, or any target is exceeded
- **THEN** the evaluation is unqualified and automatic routing is disabled without retrying with weaker thresholds

#### Scenario: Qualification output is aggregate-only
- **WHEN** an evaluation is validated or published to the routing policy
- **THEN** it contains only version, corpus identity, case count, aggregate metrics, and qualification state, with no raw case content or unsafe diagnostics

### Requirement: Automatic selections expose a stable bounded rationale

Every automatic-selection decision SHALL use a stable reason code from the approved routing-reason union and a bounded user-facing explanation that does not contain request text, assistant text, source content, provider data, paths, commands, prompts, or private reasoning. An automatic review summary SHALL identify its invocation as `automatic` and carry the selection rationale without changing evidence status or structural-review status.

#### Scenario: Rationale is visible for an automatic review
- **WHEN** a response is automatically selected and the review returns a bounded summary
- **THEN** the host publishes the summary with invocation `automatic`, and the review card displays the stable explanation for why it was selected

#### Scenario: Unrecognized rationale is rejected
- **WHEN** a router or controller returns an unknown reason code, an over-limit explanation, or unsafe content
- **THEN** the host rejects the automatic result as non-success and does not publish raw or guessed rationale

#### Scenario: Manual summaries remain compatible
- **WHEN** a manually requested review has no automatic-routing metadata
- **THEN** it renders with the existing manual card behavior and no automatic rationale is shown

### Requirement: Routing is isolated, deduplicated, and post-response only

The host SHALL bind an automatic review to the active session, assistant message, and current session generation. It MUST select at most one automatic review for a binding, MUST not supersede an in-flight manual review, and MUST ignore or cancel stale, switched-session, deleted, repeated, cancelled, timed-out, or terminal work. Automatic routing MUST never withhold, rewrite, approve, reject, or release the original OpenCode response.

#### Scenario: A duplicate idle event does not duplicate review
- **WHEN** the same completed assistant message produces multiple idle notifications
- **THEN** at most one automatic controller request is made for that session/message/generation binding

#### Scenario: Manual review takes precedence
- **WHEN** a manual review is already in flight for a message when automatic selection is considered
- **THEN** automatic routing skips that message and leaves the manual request unchanged

#### Scenario: Session changes invalidate automatic work
- **WHEN** the active session changes or the target session/message is deleted while automatic review is pending
- **THEN** the pending result is cancelled or ignored and no stale summary is published to the new session

#### Scenario: Automatic review cannot become a release gate
- **WHEN** automatic review is selected after an assistant response has been delivered
- **THEN** the original response remains published regardless of review outcome, and no response-gate transaction is created or released

### Requirement: Routing preserves product and security boundaries

Automatic routing SHALL remain private to the host/review boundary and SHALL not add AF, shell, terminal, package, arbitrary process, network, plugin, MCP, task delegation, child-agent, permission, sandbox, nono-profile, global-configuration, or independent-TUI capabilities. When routing is unavailable or disabled, the existing manual and unavailable-review paths SHALL remain usable.

#### Scenario: Boundary-negative routing stays non-executing
- **WHEN** automatic routing evaluates an eligible response in a fixture or unavailable environment
- **THEN** it performs no process launch, filesystem/proof-workspace write, network request, tool invocation, child-agent request, permission change, or configuration write

#### Scenario: Existing product boundaries remain unchanged
- **WHEN** the automatic-routing change is activated with its default settings
- **THEN** Scout, Write, the research worker, MCP policy, Chat sandbox, normal session messaging, and the independent TUI retain their existing permissions and behavior

### Requirement: User-facing routing text is localized and bounded

Any automatic-routing label, rationale label, unavailable message, and accessibility text added to the webview SHALL have entries in every supported locale dictionary and SHALL render bounded text without exposing private review material.

#### Scenario: Every locale provides routing labels
- **WHEN** the review card renders an automatic summary under any supported locale
- **THEN** it uses a translated label and stable reason explanation without falling back to an unlocalized key
