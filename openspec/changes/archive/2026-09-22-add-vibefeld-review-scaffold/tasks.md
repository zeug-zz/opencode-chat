## 1. Shared Contract

- [x] 1.1 Add provider-neutral reasoning-review runtime, status, evidence,
  summary, challenge, and opaque artifact-handle types in `packages/core/src`,
  and verify focused core type tests compile them.
- [x] 1.2 Export the new core module and add typed review request, cancellation,
  runtime, and summary protocol messages, and verify protocol serialization tests
  cover every discriminant.
- [x] 1.3 Add core tests covering discriminated protocol messages and the absence
  of provider-specific fields from the shared public contract, and verify the
  focused core suite passes.

## 2. Host Review Boundary

- [x] 2.1 Add the platform-owned `IReasoningReviewController` contract and an
  `UnavailableReasoningReviewController` under `packages/platforms/vscode/src/vibefeld/`,
  and verify its unit tests construct the unavailable runtime state.
- [x] 2.2 Ensure the unavailable implementation returns bounded unavailable
  summaries and performs no process, filesystem, network, configuration, model,
  plugin, MCP, launch-configuration, or permission side effect. Verify this with
  mocked side-effect boundaries.
- [x] 2.3 Add a bounded visible-assistant-text source-packet helper that excludes
  reasoning parts, tool data, attachments, permission metadata, and prompts, and
  verify inclusion, exclusion, and truncation cases in unit tests.
- [x] 2.4 Construct and inject the unavailable controller from `extension.ts`
  without changing the OpenCode SDK adapter, overlays, or sandbox configuration,
  and verify the existing launch-configuration tests remain unchanged.

## 3. Host Routing and Lifecycle

- [x] 3.1 Route typed review and cancellation messages in `ChatViewProvider`, and
  verify both message types reach the injected controller in host tests.
- [x] 3.2 Validate active-session ownership, completed assistant-message type,
  source-packet bounds, and returned message identifiers before invoking or
  publishing controller results, and verify invalid requests never invoke it.
- [x] 3.3 Track in-flight review requests by session and message so cancellation,
  navigation, and deletion discard stale results, and verify each stale-result
  path in host tests.
- [x] 3.4 Publish runtime and matching review-summary messages without altering
  OpenCode message parts or streamed reasoning events, and verify existing
  reasoning-streaming tests still pass.
- [x] 3.5 Add extension-host tests for valid requests, invalid/cross-session
  requests, non-assistant/incomplete messages, cancellation, navigation,
  deletion, unavailable fallback, and unchanged launch/permission state, and
  verify the focused extension-host suite passes.

## 4. Webview Presentation

- [x] 4.1 Add session/message-keyed review-summary state and typed host-message
  handling in the webview, and verify summaries remain isolated by session and
  message in hook or scenario tests.
- [x] 4.2 Add a localized `Review argument` action for completed assistant
  messages and post typed requests/cancellation messages, and verify interaction
  tests emit the expected protocol payloads.
- [x] 4.3 Add `ReasoningReviewCard` below the matching assistant message with
  distinct unavailable, reviewing, structurally checked, conditional, unresolved,
  refuted, blocked, and audit-failed presentations, and verify a component or
  scenario test covers every status label.
- [x] 4.4 Keep the card separate from `ReasoningPartView`; do not render raw
  provider data, source packets, prompts, workspace paths, or private reasoning,
  and verify rendered-card tests exclude those fields.
- [x] 4.5 Add locale keys to every webview dictionary and update component,
  scenario, and accessibility tests for placement, status, locale, and stale
  state behavior, and verify the locale completeness test passes.

## 5. Verification

- [x] 5.1 Run focused core, extension-host, and webview test suites for the new
  contract, routing, and presentation behavior.
- [x] 5.2 Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`.
- [x] 5.3 Run `openspec validate add-vibefeld-review-scaffold --strict` and
  `git diff --check`.
