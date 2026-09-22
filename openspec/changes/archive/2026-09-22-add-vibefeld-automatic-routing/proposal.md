## Why

Manual Vibefeld review is useful but remains entirely user initiated, so it cannot provide measured coverage for responses whose structure or evidence dependencies warrant an explicit review. This change adds a host-owned, opt-in automatic-routing capability that selects only bounded, eligible post-response reviews after a versioned evaluation has met latency, calibration, and false-challenge targets, while keeping ordinary Chat, Write, lookup, translation, and creative work unchanged by default.

## What Changes

- Add a private automatic-routing contract and deterministic eligibility policy for completed assistant responses.
- Require explicit enablement, an available review runtime, and a qualified versioned evaluation result before any automatic selection.
- Measure and validate a review corpus using bounded aggregate metrics: minimum corpus size, p95 routing latency, expected calibration error, and false-challenge rate.
- Exclude ordinary lookup, translation, creative, coding, worker, incomplete, stale, duplicate, and manually reviewed responses from automatic selection.
- Preserve post-response semantics: automatic routing may request a review after delivery, but it is never represented as response gating or a mandatory release decision.
- Publish only bounded, structured routing reason codes and calibrated summaries; never expose prompts, private reasoning, source packets, provider payloads, paths, ledgers, or raw evaluation cases.
- Show the bounded automatic-selection reason in the existing review card and keep manual-review behavior compatible.
- Add focused fixture, host, webview, localization, and security-negative coverage. The production extension remains disabled unless a real runtime and qualified evaluation are explicitly supplied.

## Capabilities

### New Capabilities

- `vibefeld-automatic-routing`: Host-owned, opt-in, measured automatic selection of eligible post-response reasoning reviews with visible bounded rationale and fail-closed behavior.

### Modified Capabilities

- None. The existing manual review, response-gate, Chat, Write, Scout, worker, MCP, sandbox, and TUI requirements are not changed by this proposal.

## Impact

- Affected platform code: private files under `packages/platforms/vscode/src/vibefeld/` and the existing `ChatViewProvider` integration seam.
- Affected shared contract: additive optional routing metadata on the provider-neutral reasoning-review summary; no `IAgent` or SDK changes.
- Affected webview: the existing reasoning-review card and all locale dictionaries display a bounded automatic-routing explanation when present.
- Affected tests: focused platform, core, webview, and negative-boundary suites plus OpenSpec validation.
- No new process, shell, network, plugin, MCP, child-agent, AF, proof-workspace, nono-profile, permission, global configuration, or independent-TUI behavior is introduced.

## Risks and Fallback

A heuristic could over-select ordinary work or create false challenges. Qualification is therefore fail-closed: missing or stale evaluation evidence, unavailable/incompatible runtime, disabled settings, unsupported work mode, malformed input, or any bound violation produces no automatic review. The existing manual request path and unavailable controller remain the compatibility fallback. Routing is post-response only and must never be described as a response-release gate.

## Compatibility Impact

Automatic routing is disabled by default and is not activated by the current extension bootstrap without an explicitly supplied qualified evaluation and available runtime. Ordinary Chat and Write, manual review, Scout delegation, worker permissions, MCP policy, sandbox policy, OpenCode configuration, and the independent TUI remain unchanged. Existing summaries without routing metadata continue to render exactly as before.
