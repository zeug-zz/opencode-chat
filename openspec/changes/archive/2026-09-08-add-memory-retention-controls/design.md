## Context

See `proposal.md` for motivation and externally visible scope. The previous Hindsight change deliberately exposes only exact recall/reflect tools and suppresses provider lifecycle hooks. The companion already has a typed core protocol, a VS Code settings panel, a workspace-aware sandbox policy, and an OpenCode permission queue. Hindsight provider-specific tool names and runtime details remain in the OpenCode adapter; core and webview surfaces must use normalized policy/status data.

The key constraint is that retention is a durable external write, not an ordinary read tool. It must therefore remain opt-in, confirmation-gated, bounded, and independent from automatic session retention. A provider failure must not prevent the existing companion or AGENTS.md fallback from working.

## Goals / Non-Goals

**Goals:**

- Add a normalized retention policy and sanitized retention status to the existing core/host/UI boundaries.
- Persist the policy at workspace scope with fail-closed handling for malformed or managed settings.
- Add one exact Hindsight retention operation only after capability, tool-inventory, policy, and sandbox checks pass.
- Reuse the existing permission UI for per-request confirmation while preventing a retention permission from becoming a permanent bypass when confirmation is required.
- Apply a deterministic bounded/redacted payload policy at the host/provider boundary and keep rejected writes nonfatal.
- Preserve the existing read/reflect permissions, Scout worker restriction, Build wildcard denial, lifecycle-hook suppression, and independent TUI configuration.

**Non-Goals:**

- Direct Hindsight HTTP/API calls, arbitrary plugin loading, or provider configuration writes.
- Deletion, page administration, diagnostics, synchronization, or a generic provider registry.
- Enabling automatic transcript/session retention or removing `HINDSIGHT_DISABLE_HOOKS`.
- Replacing AGENTS.md guidance or exposing raw provider output/credentials in the webview.

## Decisions

### 1. Store a small normalized policy at workspace scope

Use the existing VS Code workspace configuration boundary for retention controls so settings can be persisted, inspected for organization management, and resolved before the companion launch. The normalized policy contains only provider-neutral booleans: explicit retention enabled, confirmation required, and the effective automatic-retention flag. Defaults are explicit retention off, confirmation on, and automatic retention off. Invalid values resolve to the safe default; managed settings are never overwritten. The automatic flag is reported as disabled and is not allowed to turn lifecycle hooks on in this change.

A workspace configuration is preferred over an unscoped process variable or provider config because it is visible to the user, compatible with organization policy, and does not modify the independent TUI. A webview-only preference is insufficient because the launch overlay and permission boundary are host-side.

### 2. Keep retention policy separate from read/reflect status

Extend the core protocol with a sanitized retention policy/status shape rather than adding Hindsight tool names or paths to core. The host publishes the effective policy and a small availability state (`disabled`, `available`, `blocked`, `unavailable`, or `error`) with bounded provider-neutral reasons. Recall and reflect capability status remains independently observable; enabling retention must not imply either capability or automatic retention.

### 3. Add one exact, confirmation-gated provider operation

The Hindsight adapter recognizes only the approved retention tool ID (`hindsight_ingest_document`) and only when the detected status has `retain: true` and the post-launch inventory contains that exact ID. It returns a separate retention permission fragment so existing recall/reflect tools stay unconditional read/evidence allows while the retention tool is configured as `ask`. No wildcard or inferred Hindsight name is emitted, and the tool is added only to Scout and Build, never to `chat-research-worker`.

An exact tool is preferred over a wildcard because Hindsight versions and unrelated plugins can expose similarly named write/admin operations. Retention remains absent when policy, inventory, capability, provider state, or sandbox viability is not satisfied.

### 4. Make confirmation non-persistent by default

Track retention permission requests in the host message router using the exact permission/tool identity. Route them through the existing permission UI, but when `requireConfirmation` is true, translate an `always` response for the retention tool into a one-request response. This preserves the established permission UX without allowing a durable external write to silently become permanently trusted. Reject, timeout, and provider-error paths publish no success state.

The adapter does not auto-confirm based on prompt text or provider status. Prompt guidance is informative only; exact tool permissions and the host confirmation policy are the security boundary.

### 5. Enforce a bounded redaction policy at the retention boundary

Add a small pure policy helper in the provider/host boundary that accepts only a structured retention summary, rejects empty or over-limit content, strips recognized credential/authorization patterns, and refuses payloads that still contain secret markers after redaction. The helper also drops raw tool payloads, full documents, private path/configuration fields, and untrusted source content unless an explicit user-approved summary is supplied. Limits and redaction behavior are deterministic and covered by tests.

If a provider invocation cannot expose structured input at the host confirmation boundary, the adapter fails closed instead of assuming that prompt guidance sanitized it. This keeps the implementation from treating model instructions as the security boundary.

### 6. Preserve the existing launch and fallback behavior

Pass the normalized retention policy into the same in-memory launch overlay used for unsandboxed and sandboxed servers. Provider read-path viability and network policy continue to use the existing sandbox checks. The integration always retains `HINDSIGHT_DISABLE_HOOKS=1`; explicit retention is possible only through the confirmed exact tool, never through lifecycle hooks. If policy loading, provider resolution, tool inventory, payload validation, or sandbox preparation fails, remove only the retention capability and keep the requested sandbox mode, read/reflect behavior where safe, ordinary Chat/Write, and AGENTS.md context.

## Risks / Trade-offs

- [A model proposes a secret or large transcript for retention] → validate structured input at the host boundary, redact recognized secret forms, reject residual secret markers, enforce a hard size limit, and test negative cases.
- [A user selects an "always" permission response] → clamp retention permissions to a single request whenever confirmation is required.
- [Hindsight versions expose a different write tool] → require exact observed inventory and retain capability; do not guess or wildcard-match.
- [Retention integration fails during startup] → keep the base overlay and same sandbox mode, publish a sanitized unavailable/blocked state, and leave read/reflect and AGENTS.md fallback intact.
- [Settings are organization-managed or malformed] → treat them as disabled/confirmation-required and never write back over managed values.
- [Provider lifecycle hooks accidentally write outside the tool call] → keep `HINDSIGHT_DISABLE_HOOKS=1` and test that explicit retention does not alter the lifecycle environment.
- [Adding a write tool widens Build or Scout] → assert exact retention permissions for the two primary agents and negative coverage for the worker, shell, edit, task, package, terminal, deletion, admin, and unknown patterns.

## Migration Plan

No migration is required. Existing workspaces resolve to explicit retention disabled and continue using the current read/reflect behavior and AGENTS.md fallback. Users who enable the new workspace setting receive the exact confirmation-gated retention path after the next companion launch/reconnect. Rollback removes the retention settings/overlay/protocol additions; existing read-only memory behavior and the independent TUI configuration remain intact.
