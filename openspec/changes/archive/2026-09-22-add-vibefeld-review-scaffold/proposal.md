## Why

OpenCode Scribe has no safe, typed way to associate an optional reasoning-review
result with a completed assistant response. Establishing that contract now lets
the extension add an inspectable manual review experience without claiming that
AF execution, adversarial model review, or response gating already exists.

## What Changes

- Add provider-neutral reasoning-review runtime, status, evidence, and summary
  types to the shared core package, including an opaque artifact handle rather
  than provider-specific paths, node identifiers, CLI data, or ledger content.
- Add typed webview-to-host manual-review requests and host-to-webview runtime
  and per-message summary messages.
- Add a VS Code host-owned review-controller interface and an unavailable
  implementation that returns a bounded unavailable result without launching a
  process, writing files, changing configuration, or prompting a model.
- Route and validate requests in `ChatViewProvider`, extracting only bounded
  visible assistant text from a completed message in the active session.
- Add session/message-scoped webview state and a localized compact review card
  below the matching assistant message.
- Add focused core, extension-host, and webview tests for session isolation,
  unavailable fallback, stale results, cancellation, localization, and absence
  of runtime side effects.

### Scope and Non-Goals

This change is a non-executing scaffold. It does not discover or launch AF,
create a proof workspace, add a Settings control, introduce an OpenCode plugin,
MCP server, custom tool, or agent overlay, modify `IAgent`, alter streaming
reasoning rendering, or change the existing Chat sandbox, Scout, Write, worker,
MCP, or TUI permissions.

It also does not add prover/verifier agents, automatic routing, source
verification, AF claim graphs, ledger rendering, persistence beyond the active
webview/session state, or a draft/review/release response gate.

## Capabilities

### New Capabilities

- `vibefeld-reasoning-review`: Provides a provider-neutral, manually requested
  reasoning-review contract, safe unavailable fallback, host validation, and
  per-message review presentation without executing an external runtime.

### Modified Capabilities

None. The review card is separate from `reasoning-streaming`; this change does
not modify streamed model reasoning behavior. It also preserves the existing
`companion-scoped-scout` permission boundary and `chat-agent-sandbox` policy.

## Impact

- Affected code: `packages/core/src`, `packages/platforms/vscode/src`, and the
  VS Code webview components, state, styles, and locale dictionaries.
- Affected API: new typed core and webview/host protocol messages only; existing
  OpenCode SDK adapter and server event contracts remain unchanged.
- Dependencies: no AF binary, package, plugin, MCP server, network service, or
  new third-party dependency is introduced.
- Compatibility: ordinary Chat, Write, reasoning streaming, sandbox behavior,
  companion overlays, and the independent OpenCode TUI retain their current
  behavior. A missing or unavailable review runtime returns a bounded
  `unavailable` result rather than blocking a response or broadening authority.
- Risks: stale or cross-session results, accidental exposure of reasoning/tool
  data, and future runtime scope creep. The host validates session/message
  ownership, passes only bounded visible text to the controller, clears stale
  review state, and tests that the scaffold has no process, filesystem,
  configuration, plugin, or permission side effects.
