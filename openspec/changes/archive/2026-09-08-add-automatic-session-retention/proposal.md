## Why

The companion’s Hindsight integration currently suppresses provider lifecycle hooks and forces automatic session retention off, even when an approved Hindsight provider is available. The requested product behavior is to make automatic session retention active by default for approved, usable Hindsight sessions while keeping no-provider operation, explicit user disablement, bounded provider behavior, and the existing Chat/Write security boundaries intact.

## What Changes

- Add a provider-neutral automatic-session-retention policy whose default is enabled, while preserving an explicit workspace disable switch and organization-managed fail-closed behavior.
- Gate automatic retention on an exact approved Hindsight integration, successful provider/sandbox preparation, and a provider capability that has passed the companion lifecycle verification contract.
- Enable Hindsight’s provider-native lifecycle retention only for the companion process when the effective policy is enabled; keep the independent OpenCode TUI configuration unchanged.
- Remove the unconditional `HINDSIGHT_DISABLE_HOOKS=1` behavior for the active automatic-retention path, while retaining it for explicit-retention-only, disabled, unavailable, blocked, and fallback paths.
- Keep automatic retention separate from explicit `hindsight_ingest_document` confirmation and from recall/reflect tool permissions.
- Require provider-owned retention to produce bounded summaries and exclude credentials, secrets, raw tool payloads, large documents, untrusted web content, and unrelated private workspace data; surface sanitized failure status without blocking Chat/Write.
- Add lifecycle, default-policy, disablement, sandbox parity, no-provider fallback, reconnect, and live-verification-shaped tests.

## Capabilities

### New Capabilities

- `automatic-session-retention`: Provider-gated automatic Hindsight session retention with an enabled-by-default policy, explicit disablement, bounded/sanitized retention guarantees, and fail-closed fallback behavior.

### Modified Capabilities

None. The existing retention-controls delta remains the contract for explicit, confirmation-gated retention; this change adds the separately controlled automatic lifecycle capability.

## Scope and Non-goals

This change covers the companion’s automatic-retention policy, Hindsight lifecycle environment, provider capability/status handling, session lifecycle gating, sandbox parity, and verification. It does not add provider deletion or administration, arbitrary plugin loading, AGENTS.md writes, raw transcript storage by the host, new recall/reflect tools, explicit-retention confirmation changes, or automatic retention when no approved provider is usable. It does not alter the independent TUI’s lifecycle behavior.

## Risks, Fallback, and Compatibility

Enabling automatic retention by default is a durable-write behavior change. It is limited to an exact approved Hindsight provider that passes the existing sandbox and capability gates, remains independently disableable, and is never attempted when provider resolution, inventory, sandbox preparation, or lifecycle support fails. If automatic retention fails, the companion remains usable and reports only a bounded provider-neutral state; it does not retry unsandboxed or claim success. Existing workspaces without Hindsight retain the AGENTS.md/ordinary-context fallback, and explicit retention remains separately confirmation-gated.

## Impact

Affected areas are the provider-neutral retention policy/status types, Hindsight companion integration and launch environment, VS Code workspace settings and lifecycle event handling, host/agent tests, and documentation/status assertions. No new dependency, migration, provider configuration write, or independent TUI change is required.
