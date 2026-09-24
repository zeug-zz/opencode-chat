# Spec Delta

## ADDED Requirements

### Requirement: Select host-private reasoning-assist dependencies during activation

During the single activation composition the host MAY additionally resolve, fail
closed and nonfatally, a readiness-gated restricted review adapter and - only
when the already-preflighted bridge reports an explicitly supported claim
operation - a structure recorder over the current claim projection seam, and
SHALL inject both into the chat view provider. This selection SHALL NOT run a
second bridge preflight, SHALL NOT expose any model-visible authority, and SHALL
leave dormant activation, ordinary Chat, Write, Scout, worker, sandbox, and TUI
behavior unchanged. The assist stays dormant whenever a dependency is absent.

#### Scenario: Ready runtime with a supported claim operation injects both dependencies

- **WHEN** the activation preflight is ready, the bridge reports a supported
  claim operation, and a pinned restricted review model passes readiness
- **THEN** the host SHALL inject the restricted review adapter and the structure
  recorder into the chat view provider
- **AND** eligible prompts SHALL run the bounded preflight and dispatch with the
  appended assist brief

#### Scenario: Dormant or partial activation keeps the assist dormant

- **WHEN** the runtime is dormant, the claim operation is unsupported, or the
  restricted provider fails readiness
- **THEN** the host SHALL omit the unavailable dependency, publish the existing
  bounded runtime status, and dispatch every prompt unchanged
- **AND** no second preflight, no new configuration key, and no broader
  authority SHALL exist

## REMOVED Requirements

### Requirement: Gate the per-message review affordance on availability and toggle the review result
**Reason**: The completed-message review affordance and result card are retired
with the raw-prose review route.
**Migration**: A valid preflight result renders only through the prompt-scoped
reasoning-assist row; no per-message review affordance or toggle remains.

### Requirement: Enable automatic routing only from a validated qualified evaluation
**Reason**: Automatic post-response routing is retired with the raw-prose review
route, so no qualified evaluation can enable a review.
**Migration**: Eligible prompts use the prompt-scoped `vibefeld-reasoning-assist`
preflight; no automatic selection or post-response review request exists.

### Requirement: Qualify with a hybrid host-private aggregate pipeline
**Reason**: Qualification captured latency and review-card feedback only for
automatic routing, which is retired; the feedback control is removed with the
review card.
**Migration**: No seed corpus, live outcome capture, qualification aggregate, or
routing escape hatch remains.

## MODIFIED Requirements

### Requirement: Compose activation once in the extension host and publish runtime state

`extension.ts` SHALL construct the runtime bridge and the proof store beneath `context.globalStorageUri`, SHALL preflight the bridge at most once per extension activation, and SHALL inject `ClaimProjectionReasoningReviewController` only when the runtime is ready and the bridge reports an explicitly supported claim operation. When direct execution is ready but the bridge reports no supported claim operation, the host SHALL inject `UnavailableReasoningReviewController` and publish the bounded `{ state: "unavailable", reason: "claim-capability-unavailable" }` status without compiling a claim graph or claiming availability. The host SHALL publish the existing bounded runtime status so the availability-gated preference reflects `unavailable`, `checking`, `incompatible`, and `available`, and MUST NOT publish `available` without a supported claim operation. When the runtime is dormant, ordinary Chat, Write, Scout, worker, MCP, sandbox, and TUI behavior MUST remain unchanged, no per-message discovery or preflight may occur, and an activation failure MUST be nonfatal.

#### Scenario: A ready runtime with a supported claim capability selects the projection controller

- **WHEN** discovery, the compatibility contract, direct execution readiness, the storage preflight, and an explicitly supported claim operation all succeed during extension activation
- **THEN** the host SHALL inject `ClaimProjectionReasoningReviewController` and publish an available runtime status
- **AND** no completed-message review request SHALL be offered

#### Scenario: A compatible runtime without claim projection stays review-unavailable

- **WHEN** discovery, the compatibility contract, direct execution readiness, and the storage preflight succeed but the bridge reports no supported claim operation
- **THEN** the host SHALL inject `UnavailableReasoningReviewController` and publish the bounded `{ state: "unavailable", reason: "claim-capability-unavailable" }` status
- **AND** no claim graph SHALL compile, no claim operation SHALL run, and no reasoning-assist preflight SHALL claim availability

#### Scenario: A dormant runtime keeps the unavailable controller

- **WHEN** AF is absent, incompatible, or unsupported, or direct execution readiness is unavailable
- **THEN** the host SHALL inject `UnavailableReasoningReviewController` and publish the matching bounded status
- **AND** no process SHALL launch, no proof workspace SHALL be created, and ordinary Chat and Write SHALL behave exactly as before

#### Scenario: Preflight runs at most once per activation

- **WHEN** multiple prompts, session switches, or ordinary messages occur during one activation
- **THEN** discovery and preflight SHALL NOT run again for ordinary messages
- **AND** runtime status SHALL be reused until the extension deactivates

### Requirement: Retain every model-visible and broader-authority prohibition

Activation SHALL permit only the constrained wiring: host-owned discovery, direct execution, mode-selected live parsers, proof storage beneath extension global storage, one preflight, dynamic controller selection, and the availability-gated preference. AF MUST NOT be added as an OpenCode plugin, `pluginSources` entry, MCP server, custom tool, agent overlay, or task target; `IAgent` and the webview protocol MUST NOT gain AF fields; and callers MUST NOT supply arbitrary argv, executable paths, workspaces, or environment overrides. No response gate, adversarial prover/verifier, restricted child-model context, Hindsight runtime call, Windows policy, model-visible AF, nono invocation or profile mutation, nested sandbox, or TUI/global configuration change SHALL be introduced. Security-negative tests SHALL be amended only through the explicit MODIFIED requirements carried by this change, and every retained prohibition SHALL keep failing closed under test.

#### Scenario: Broader authority surfaces stay absent

- **WHEN** the activation wiring is inspected in extension, agent, launch configuration, plugin, and MCP sources
- **THEN** plugin sources, MCP entries, custom tools, agent overlays, and `IAgent`/protocol AF fields SHALL remain absent
- **AND** no arbitrary argv, executable, workspace, or environment input SHALL be reachable from a model or webview

#### Scenario: Deferred capabilities remain unactivated

- **WHEN** the extension activates with a ready runtime
- **THEN** the response gate SHALL remain a fixture-level contract and no prover/verifier agent, tool, or plugin SHALL exist
- **AND** Hindsight SHALL remain an offline developer aid with no runtime routing or ingestion path

#### Scenario: Security negatives fail closed on attempted widening

- **WHEN** the amended security-negative suites run
- **THEN** they SHALL permit only the constrained wiring and SHALL fail on any plugin, MCP, custom-tool, agent-overlay, permission, nested-sandbox, nono-invocation, or arbitrary-argv widening
- **AND** ordinary Chat, Write, Scout, worker, sandbox, and TUI boundaries SHALL remain pinned
