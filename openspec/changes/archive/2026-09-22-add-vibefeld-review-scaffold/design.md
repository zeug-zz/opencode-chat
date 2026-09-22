## Context

See `proposal.md` for motivation and scope. Scribe currently sends assistant
responses directly through the OpenCode client and forwards message events while
companion sandbox grants workspace writes that are incompatible with a dedicated
AF proof root. The existing `reasoning-streaming` capability renders model
reasoning parts and must remain independent of review artifacts.

This change crosses shared core types, the VS Code extension host, and the
webview. It must preserve the current Scout, Write, worker, plugin, MCP,

## Goals / Non-Goals

**Goals:**

- Establish a typed, provider-neutral reasoning-review domain and webview/host
  protocol.
- Support a manual review action on completed assistant messages.
- Make unavailable-runtime behavior observable and safe without introducing AF
  execution or persisted proof data.
- Keep result ownership and sensitive-data filtering in the extension host.
- Render a compact localized review card independently of reasoning streaming.

**Non-Goals:**

- AF discovery, process execution, proof workspaces, or configuration controls.
- Changes to `IAgent`, OpenCode event handling, plugin overlays, MCP inventory,
  or agent permissions.
- Prover/verifier model contexts, automatic routing, evidence verification,
  ledger inspection, persistent review history, or pre-release response gating.

## Decisions

### Add a dedicated provider-neutral core module

Add `packages/core/src/reasoning-review.ts` and export it from the core barrel.
It owns `ReasoningReviewRuntime`, `ReasoningReviewStatus`,
`ReasoningEvidenceStatus`, `ReasoningReviewSummary`, and shared supporting
types. `protocol.ts` imports those types and adds discriminated request,
cancellation, runtime, and summary messages.

The contract has an opaque `artifactHandle`, not AF-specific node/workspace
fields. This preserves the core package's provider-neutral boundary and lets a
future runtime map private identifiers only inside its own adapter.

Alternative considered: add AF fields to `domain.ts` and model the result as an
OpenCode message part. Rejected because it leaks provider details into shared
domain state and relies on OpenCode persistence for a host-owned review that the
server does not produce.

### Inject a host-owned controller into ChatViewProvider

Add `IReasoningReviewController` and `UnavailableReasoningReviewController`
under `packages/platforms/vscode/src/vibefeld/`. `extension.ts` constructs the
unavailable controller and passes it to `ChatViewProvider` through an additive
dependency option. The controller exposes runtime status, a review operation,
and cancellation; it has no access to the webview or OpenCode SDK.

The unavailable implementation returns a bounded `unavailable` summary and has
no process, filesystem, network, configuration, plugin, or model side effect.

Alternative considered: extend `IAgent` with review methods. Rejected because
the first implementation is a VS Code host capability rather than an OpenCode
SDK feature, and extending the agent interface would force provider behavior
into an unrelated adapter boundary.

### Validate source ownership and construct packets in the host

`ChatViewProvider` handles review requests. It verifies that the requested
session is active, obtains the authoritative message list through the existing
agent API, confirms a completed assistant message, and extracts bounded text
from visible text parts only before invoking the controller. Invalid requests
are rejected without controller invocation or data publication.

The host retains a session/message-keyed pending-request record. A cancellation,
session switch, or session deletion invalidates the record so a late completion
cannot overwrite current state. The controller result carries the reviewed
message ID and the host verifies it before forwarding.

Alternative considered: let the webview concatenate message parts and call the
controller directly. Rejected because the webview is not an authority boundary
and could request cross-session content or pass private tool/reasoning data.

### Keep review state ephemeral and separate from message parts

The host sends review summaries as standalone protocol messages. A webview hook
maintains a map keyed by session ID and assistant message ID; `MessagesArea` and
`MessageItem` receive only the matching summary and review action. Session
selection and deletion clear or ignore stale entries.

The webview renders a new `ReasoningReviewCard` beneath the message instead of
reusing `ReasoningPartView`. The card has status-first presentation, bounded
assumption/challenge expansion, and no raw controller output. All labels are
provided through `useLocale()` and every locale dictionary receives matching
keys.

Alternative considered: persist a synthetic review message through OpenCode.
Rejected because it would modify conversation history, could confuse response
ordering, and would require the server to own data it did not generate.

### Leave runtime execution as a separate security change

The scaffold contains no AF path resolution, runtime manager, subprocess API,
or workspace store. A future `add-vibefeld-runtime-contract` change must first
capture the installed AF CLI contract and prove a dedicated OS process boundary.
The existing companion sandbox cannot be reused without that proof because it
permits active-workspace writes.

Alternative considered: preflight AF from the controller. Rejected because an
optional preflight still starts a process, expands the security review surface,
and would make the initial fallback no longer side-effect free.

## Risks / Trade-offs

- [The scaffold displays an unavailable card rather than a working proof] -> It
  establishes and tests the correct product boundary before adding authority.
- [A separate protocol/state path adds UI plumbing] -> It prevents review data
  from contaminating OpenCode message persistence or reasoning streaming.
- [Late results can race session navigation] -> Host-owned request tokens and
  session/message validation discard stale results.
- [Visible message text may contain sensitive user-provided material] -> The
  host extracts only the selected assistant text, bounds it before controller
  invocation, and the unavailable implementation neither persists nor logs it.
- [Future AF work could broaden authority] -> The scaffold has explicit negative
  tests and no runtime/process abstractions that could accidentally execute AF.

## Migration Plan

The change is additive and has no persisted data or configuration migration.
Existing conversations render unchanged until a user requests a review; then the
unavailable controller returns a local summary. Rollback consists of removing
workspaces, provider state, or configuration entries require cleanup.
