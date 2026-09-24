# Tasks

## 1. Replace The Raw-Review Surface

- [x] 1.1 Add provider-neutral prompt-scoped reasoning-assist progress and compact-summary types plus typed host/webview protocol messages in `packages/core`, and verify exact-shape and protocol coverage in focused core tests.
- [x] 1.2 Remove the production completed-message `Review argument` trigger, the raw visible-assistant-text source-packet route used by the manual and automatic post-response paths, the automatic-routing invocation and qualification capture that depended on it, and the persistent `blocked` review card; retain only prompt-scoped assist state and the shared restricted/AF safety scaffolding, and verify ordinary assistant prose is never passed to `compileClaimGraph()` by any production path.
- [x] 1.3 Add localized reasoning-assist lifecycle strings to every webview locale dictionary and verify locale tests resolve all new user-facing labels.

## 2. Build The Bounded Preflight Inputs

- [x] 2.1 Generalize the host-owned restricted provider and overlay only for `architect` and `critic` stages, preserving the exact deny map, host-pinned model, generation-bound readiness, hidden-session lifecycle, bounded retrieval, cancellation, and disposal; verify focused agent and adapter tests reject broader authority and keep raw stage text private.
- [x] 2.2 Implement the fixed architect packet and exact JSON result parser for `ordinary` or bounded argument-map output; convert only valid output to the private claim graph and verify valid, malformed, unsafe, cyclic, missing-dependency, and over-limit cases without AF or child critic work on failure.
- [x] 2.3 Implement the fixed one-stage critic packet and bounded objection normalizer with a maximum of two objections targeting known claims or assumptions; verify malformed, unsafe, unknown-target, timeout, cancellation, and stale results are discarded without a verifier context or raw-output publication.

## 3. Orchestrate Reasoning Assistance Before Dispatch

- [x] 3.1 Add an assist orchestrator that runs the architect once for eligible Scribe text prompts, publishes ordered progress, dispatches ordinary or failed cases unchanged, and verifies command, attachment, retry, non-Scribe, and ineligible prompts do not create hidden work.
- [x] 3.2 After a valid graph, run contracted AF recording and the optional critic concurrently within the bounded preflight budget; verify either optional stage can fail or be unavailable without blocking normal dispatch, and AF success is represented only as recorded structure.
- [x] 3.3 Integrate the orchestrator into `ChatViewProvider.dispatchPrompt()` and append one bounded host-built assist brief to the existing normal system instruction; verify the original prompt, selected model, primary agent, files, skill, command, effort, queue behavior, and streamed answer path are preserved.
- [x] 3.4 Add prompt-token and generation guards for superseding prompts, cancellation, session changes, deletion, reconnect, and deactivation; verify late progress, AF facts, critic objections, or briefs cannot affect another prompt and all hidden contexts are cleaned up.

## 4. Render The Compact Assist Experience

- [x] 4.1 Add webview state and a compact expandable `Reasoning assist` row linked to the pending prompt and resulting response; verify it shows safe ordered progress, renders only validated summary fields, and never reuses the model `Thought` or raw review-card UI.
- [x] 4.2 Verify an ordinary, invalid, unavailable, cancelled, or stale preflight removes pending activity with no persistent spinner, card, or `blocked` state; verify a valid applied brief remains scoped to its originating session, prompt, and response.

## 5. Security And End-To-End Verification

- [x] 5.1 Extend focused security-negative tests to prove no AF, architect, or critic model-visible route exists through `IAgent`, tasks, plugins, MCP, Scout, Write, the research worker, or the TUI, and that no production completed-message or automatic post-response review path remains; verify no configuration, profile, workspace, permission, or sandbox widening occurs.
- [x] 5.2 Run focused core, agent, extension-host, and webview suites for the new contracts, parser, orchestrator, lifecycle, and UI; run any child-model live proof only with the existing explicit disposable gate and report a safe skip when its prerequisites are absent.
- [x] 5.3 Run `pnpm run check`, `pnpm run build`, `pnpm run test:all`, `openspec validate replace-vibefeld-raw-audit-with-reasoning-assist --strict`, and `git diff --check`; verify no production-code changes occur outside the approved implementation scope and no commit or push is performed.

## 6. Activate And Trim

- [x] 6.1 Wire the reasoning-assist dependencies during the single activation composition: attempt the readiness-gated restricted review adapter independently of the controller selection, build the structure recorder from the already-preflighted claim projection seam only when its capability is supported, inject both into `ChatViewProvider` fail-closed and nonfatally, register their disposal, and verify eligible prompts run the bounded preflight and dispatch with the appended brief while dormant activation, the single preflight, and every security negative (amended only through this explicit task) stay intact.
- [x] 6.2 Remove the unused `reasoningAssist.uncertainty` locale key from every webview locale dictionary and update the locale tests; verify the assist row continues to render only validated summary fields.
- [x] 6.3 Harden companion event delivery so an unexpected or payload-less OpenCode event cannot terminate the event stream: normalize `properties` in `mapEvent`, isolate per-listener failures in `subscribeToEvents` with a bounded once-per-type diagnostic that names only the event type and the error name, and guard the chat view provider event handler; verify a payload-less event is forwarded safely, later events still arrive after a listener throws, and task 3.4's `server.connected` reconnect invalidation is reachable.
- [x] 6.4 Read hidden stage results only after the assistant reply completes (message-level completion or per-part end timestamps, with a bounded stability fallback for marker-less servers, inside the provider-enforced deadline; never return partial streamed text), expose a bounded preflight outcome reason and the numeric stage text length on invalid results from the orchestrator, log bounded once-per-reason diagnostics in the provider, update the streaming-retrieval tests, and extend the gated live restricted-review proof to the architect and critic roles.
- [x] 6.5 Enumerate the bounded enum values the stage schemas validate (claim classes, evidence source kinds, evidence statuses, critic severities) inside the host-owned architect and critic instructions, pin instruction-to-parser enum parity with a cross-package source test, and thread the architect parser's bounded sub-reason into the preflight outcome diagnostic so schema rejections are self-explaining.
- [x] 6.6 Keep architect generation inside the budget: request the smallest sufficient argument map in the host instruction (soft caps on claims, assumptions, evidence needs, uncertainty, and statement length), raise the stage timeout to 35s and the preflight deadline to 45s as tighter evidence-based headroom, and expose the numeric elapsed stage time on timeout diagnostics; instruction and timeout tests and delta wording updated.
