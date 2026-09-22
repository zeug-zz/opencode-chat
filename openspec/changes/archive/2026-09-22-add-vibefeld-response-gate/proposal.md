## Why

The Vibefeld runtime bridge, claim projection, and adversarial review phases now
provide bounded host-private review facts, but the existing OpenCode path still
calls `promptAsync`/`sendMessage` and streams the response immediately. The
manual review card is post-response and cannot be described as a delivery gate.
This follow-on establishes a real host-owned transactional draft/review/release
lifecycle for an explicitly opted-in, eligible response without pretending that
prompt wording, a post-stream hook, ordinary task delegation, or the current
direct-send path can withhold publication.

## What Changes

- Add a private, typed response-gate capability seam at the host publication
  boundary. A configured eligible gate must create an immutable draft, retain a
  bounded source packet, invoke the existing adversarial-review semantics, and
  release only after one valid calibrated decision.
- Define single-use transaction tokens, session/message isolation, ownership,
  bounded timeouts, cancellation, failure and audit handling, and exactly-once
  release/cancel behavior.
- Reuse existing claim projection, adversarial-review, and reasoning-review
  summary semantics. Do not add a truth/proof status or publish raw review
  material.
- Keep the default path unchanged when the gate is missing, unavailable, or
  incompatible. Keep automatic routing and general mandatory gating deferred.
- Provide a fixture-only end-to-end seam that demonstrates withholding and
  exactly-once release without an AF binary, child service, network, shell,
  active proof workspace, user profile, or absolute `/tmp` path.

## Scope

This change specifies and tests an opt-in host transaction that can sit between
eligible assistant-response completion and release to the Chat publication
surface. It includes the capability contract, state machine, bounded data
handling, calibrated decision mapping, fallback behavior, and fixture-backed
integration. The implementation must first establish this insertion point (or a
typed capability-gated equivalent) before claiming mandatory pre-release review.

## Non-Goals

- Do not claim that the current `promptAsync` streaming path is gated, or add a
  post-stream callback, prompt instruction, manual review-card shortcut, or
  direct-send wrapper that cannot withhold publication.
- Do not add automatic response selection/routing, general mandatory gating for
  ordinary Chat or Write, or a user-visible setting before the capability is
  proven and explicitly opted in.
- Do not add AF/plugin/MCP/tool/task/agent permissions, child agents, shell or
  process access, OpenCode global configuration, nono/profile changes, proof
  workspaces, or independent TUI behavior.
- Do not expose raw prompts, private reasoning, source packets, AF paths,
  commands, ledgers, child payloads, credentials, or unsafe diagnostics.
- Do not change `IAgent` or shared protocol types unless a provider-neutral
  contract is demonstrated to be unavoidable; keep Vibefeld orchestration
  private to `packages/platforms/vscode/src/vibefeld/`.

## Risks and Fallback

The principal risk is falsely reporting a response as gated when publication
already occurred. The host must fail closed: an unavailable or incompatible
capability leaves ordinary behavior unchanged and reports no gated claim; an
eligible configured gate never bypasses review. Ambiguous, malformed,
cancelled, timed-out, failed, stale, or audit-failed results cannot release.
Rollback is removal or disabling of the private gate seam; the existing direct
streaming path and unavailable/manual review behavior remain the compatibility
fallback.

## Compatibility Impact

Default extension activation, ordinary Chat and Write, Scout, worker
delegation, MCP/tool policy, sandbox behavior, OpenCode configuration, and the
independent TUI remain unchanged. Only an explicitly opted-in response with a
validated eligible capability may enter the transaction. If the insertion point
cannot be proven in the current agent path, no response is treated as gated.

## Sequencing

Implement the private contract and state machine first, then bounded adapter
mapping, then the real host insertion point, then fixture-only end-to-end tests
and security-negative coverage. Automatic routing remains a later change.
