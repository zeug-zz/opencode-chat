## Context

The existing retention-controls change deliberately made automatic retention impossible: the normalized policy forces `automaticSessionRetention: false`, the VS Code setting defaults false, the Hindsight integration always emits `HINDSIGHT_DISABLE_HOOKS=1`, and both launch paths pass that suppression into the companion process. Explicit `hindsight_ingest_document` retention is separate and confirmation-gated.

See `proposal.md` and the automatic-retention spec for the requested behavior. The repository already has exact Hindsight package resolution, observed tool inventory, sandbox runtime-path validation, process-scoped launch overlays, sanitized provider status, and lifecycle-oriented session events. The design must reuse those boundaries rather than make the host copy raw transcripts into a provider.

## Goals / Non-Goals

**Goals:**

- Make automatic retention effective by default only for an approved and verified Hindsight companion integration.
- Keep automatic retention independently disableable and independent from explicit retention, recall, and reflect.
- Activate provider-native Hindsight lifecycle behavior through the same SDK-managed and sandboxed launch paths.
- Preserve bounded/privacy and no-provider fallback guarantees through a provider lifecycle capability contract, status gating, and live verification.
- Keep failures nonfatal, process-scoped, same-sandbox, and visible only through sanitized provider-neutral status.

**Non-Goals:**

- Implementing a second host-owned summarization model or sending raw session transcripts directly to Hindsight.
- Enabling automatic retention for arbitrary providers, unrelated plugins, research-worker child sessions, or the independent TUI.
- Changing explicit retention confirmation, recall/reflect tools, deletion, provider administration, AGENTS.md writes, or sandbox deny baselines.
- Claiming live provider behavior from synthetic tests alone.

## Decisions

### 1. Use provider-native lifecycle retention, not a host transcript writer

The approved Hindsight integration already owns lifecycle hooks and its provider can produce its supported bounded session summary. A host-owned writer would need a new summarizer, transcript classification, secret filtering, retry/idempotency protocol, and provider-specific payload contract; using raw `session.status` events would risk retaining full or untrusted content. Therefore the companion will activate only the provider-native lifecycle path after the exact Hindsight integration and lifecycle-support contract pass.

The host will not call `hindsight_ingest_document` automatically and will not construct raw transcript payloads. The lifecycle-support contract and live verification are the gate that the provider’s own summary behavior satisfies the bounded/privacy requirements. If that contract or verification is unavailable, automatic retention is disabled for the process even though the user-facing default remains enabled.

### 2. Make automatic policy a real independent boolean

Change the provider-neutral retention policy’s automatic flag from a literal false to a boolean. The default policy for an absent setting is `automaticSessionRetention: true`, while explicit retention remains disabled and confirmation remains required. An explicit workspace false disables automatic retention. Malformed values fail closed for automatic writes and are never written back; organization-managed values are respected without update attempts.

The settings/status surface will distinguish automatic active/disabled/unavailable from explicit-retention state. Existing `enabled` continues to govern only explicit user-requested retention and must not be used as a prerequisite for lifecycle retention.

### 3. Add lifecycle capability to normalized provider status

Extend the provider-neutral capability/status mapping with an independently sanitized `automaticSessionRetention` capability. The Hindsight adapter reports it only for the exact approved provider after lifecycle support is accepted; unavailable, blocked, error, partial-without-lifecycle, and `none` statuses report false. Core and webview types contain no Hindsight tool IDs, paths, credentials, or hook payloads.

The integration result carries a boolean active/inactive lifecycle decision and an optional suppression environment. This keeps launch construction provider-neutral while leaving Hindsight package and lifecycle details in `packages/agents/opencode`.

### 4. Make lifecycle environment process-scoped and parity-safe

When automatic retention is active, the SDK-managed server must start without the Hindsight lifecycle-suppression variable, and the sandboxed child must explicitly remove that suppression from its copied environment. When automatic retention is inactive, both paths set `HINDSIGHT_DISABLE_HOOKS=1`. Any temporary unsandboxed environment mutation is restored immediately after server creation; no user environment or TUI configuration is persisted.

The initial launch and post-inventory reconnect must use the same decision. If a provider path, lifecycle check, or inventory check fails, reconnect to the existing base configuration in the requested sandbox mode rather than retrying unsandboxed.

### 5. Keep exact provider and sandbox gates authoritative

Automatic retention may activate only when the existing exact Hindsight package resolver, provider runtime/configuration path policy, sandbox network policy, and observed companion integration all pass. The provider registry’s `none` fallback and explicit disabled selection skip lifecycle initialization. No global plugin list is copied and no provider named by user configuration is dynamically loaded.

The lifecycle capability is additive to the existing Hindsight overlay. Recall/reflect allowlists and explicit retention confirmation remain unchanged. The independent TUI never receives the companion’s process-scoped lifecycle decision.

### 6. Test synthetic behavior and document a live acceptance gate

Unit and extension tests will cover default/false/invalid/managed policy resolution, lifecycle capability mapping, environment add/remove behavior, launch parity, reconnect/failure fallback, no-provider operation, and independent explicit-retention behavior. Fake provider fixtures may prove normalized lifecycle status but cannot prove Hindsight’s real summary privacy.

A live verification checklist will use a disposable Hindsight bank/workspace and a known non-sensitive fact. It must prove TUI isolation, Chat and Write retention/recall, one bounded later-session recall, reflect status, denied operations, disablement fallback, and sandbox parity. The automated build can pass without credentials, but the final product claim must distinguish synthetic verification from this live gate.

## Risks / Trade-offs

- [Provider-native hooks retain more than the required bounded summary] → require the lifecycle-support contract, use a disposable live test, keep raw transcript writes out of the host, and do not claim live completion until privacy checks pass.
- [A user or environment already sets `HINDSIGHT_DISABLE_HOOKS=1`] → active companion launches explicitly remove the suppression key in their process/child environment; inactive paths set it explicitly; the parent environment is restored.
- [Automatic retention surprises existing users with Hindsight] → default is explicit in settings/status, automatic retention has a workspace false switch, managed settings are honored, and docs explain the durable-write behavior.
- [Provider startup fails after automatic mode is requested] → preserve the current base launch and sandbox, mark automatic retention unavailable, and keep Chat/Write usable.
- [Capability status gains a field and breaks exact fixtures] → update protocol/core fixtures additively with false defaults and assert provider-neutral serialization.
- [Lifecycle hooks affect child/research sessions] → scope the approved integration to companion primary Chat/Write launches, deny arbitrary plugin inheritance, and verify worker/delegation boundaries in live and negative tests.

## Migration Plan

No data migration is required. On the next launch, workspaces with an approved verified Hindsight provider use automatic retention by default; workspaces without one remain no-op/fallback. Users or organizations can set the workspace automatic-retention setting to false. Rollback restores the suppression variable, false default, and existing retention normalization without changing explicit retention data or the independent TUI.
