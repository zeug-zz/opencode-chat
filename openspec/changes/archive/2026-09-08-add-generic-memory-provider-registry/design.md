## Context

See `proposal.md` for motivation and externally visible scope. The repository already has provider-neutral core descriptors, an immutable `none` descriptor, a Hindsight detector, a Hindsight companion adapter, and compatibility helpers for selecting a descriptor from injected factories. The missing boundary is a registry that owns approved adapter registration and selection without moving Hindsight runtime details into core or making dynamic plugin loading part of the extension.

The existing Hindsight flow also has security-sensitive stages: exact package resolution, same-sandbox preflight, observed-tool verification, exact permission overlays, retention confirmation, and lifecycle-hook suppression. The registry must select and describe providers, not bypass or duplicate those stages.

## Goals / Non-Goals

**Goals:**

- Add a deterministic registry for application-supplied provider adapters.
- Support automatic, explicit-provider, and explicit-`none` selection with sanitized normalized results.
- Keep the current Hindsight adapter as the first real registered provider without changing its launch or permission behavior.
- Make a fake provider usable in contract tests without Hindsight-specific core or protocol data.
- Preserve existing public discovery/selection helpers and no-provider behavior.

**Non-Goals:**

- Loading arbitrary providers, plugins, MCP servers, or modules from user configuration.
- Adding provider administration, deletion, new memory tools, automatic session retention, lifecycle hooks, or provider configuration writes.
- Adding a user-facing provider marketplace or changing the independent TUI configuration.
- Moving Hindsight paths, package names, tool IDs, credentials, or payload rules into `packages/core`.

## Decisions

### 1. Put the registry beside the provider adapters

The registry will live in `packages/agents/opencode`, where provider-specific detection and launch adapters already live. `packages/core` will retain only provider-neutral descriptor/capability and protocol shapes. This avoids coupling the webview or shared domain model to provider modules and lets the registry enforce the existing OpenCode security boundary.

The registry will accept an immutable list or an explicit registration API for adapter objects. Each adapter has a stable ID, display name, deterministic priority/order, provider-neutral detection result, and a descriptor projection. Registration validates IDs and descriptors, rejects duplicates without replacing the first entry, and never calls provider operations. The application assembles the built-in list in code; configuration cannot name a module to import.

### 2. Separate selection policy from capability detection

Selection will accept a provider-neutral preference with three meanings: automatic selection, explicit `none`, or an explicit registered provider ID. Automatic mode evaluates registered adapters in deterministic order and selects the first configured/usable result; the immutable `none` descriptor is the final fallback. An explicit provider that is unknown or unusable returns a sanitized fallback/status and does not silently switch to another provider. Explicit `none` skips all provider detection.

The default extension path remains automatic and continues to expose the current Hindsight status behavior. This change provides the registry/API boundary and deterministic selection semantics; it does not add a persisted provider marketplace or arbitrary provider configuration surface.

### 3. Preserve compatibility through adapters and wrappers

The existing Hindsight detector and descriptor normalization remain the source of truth for Hindsight status. The registry will wrap or compose that detector rather than duplicate its package resolver, capability mapping, observed-tool checks, sandbox policy, or lifecycle environment. Existing `detectMemoryProvider` and `selectMemoryProvider` callers remain valid; they delegate to the registry or retain their current semantics while new tests exercise the generic path.

A fake adapter is injected directly into registry tests. It returns only normalized capabilities and requirements, proving that selection does not require Hindsight names, paths, or tool patterns. Provider-specific launch overlays remain outside the registry and are applied only by the selected adapter's existing integration path.

### 4. Fail closed at every registry boundary

Malformed adapters, duplicate IDs, thrown detection, unsafe reasons, and unusable explicit selections are converted to a bounded provider-neutral result or the `none` fallback. Registry construction and selection do not write configuration, start plugins, call retain/recall/reflect, enable lifecycle retention, or widen agent permissions. A selected provider may proceed to its existing adapter preflight only after registry selection; an unselected provider is never initialized.

The registry returns independent retain, recall, reflect, and automatic-session-retention values. It preserves `automaticSessionRetention: false` for the built-in `none` and Hindsight descriptors in this change.

### 5. Keep status/protocol compatibility additive

No Hindsight-specific fields will be added to the webview protocol. The existing sanitized `MemoryProviderStatus` and provider-neutral descriptor remain the output shapes. If an explicit selection needs to be surfaced, only the provider-neutral ID/state/reason fields are used and unknown/raw provider details are discarded. Existing no-provider status and AGENTS.md fallback wording remain unchanged.

## Risks / Trade-offs

- [A registry entry accidentally executes provider code during registration] → registration stores validated metadata only; detection/preflight is deferred until the provider is selected.
- [Two adapters claim the same identifier] → first valid registration wins deterministically and duplicates are rejected/tested rather than silently replacing an adapter.
- [Automatic ordering changes unexpectedly] → use an explicit stable priority/order and test the same input with repeated selection.
- [A selected provider fails] → return a bounded sanitized error and the existing `none`/AGENTS.md fallback; do not silently select a different provider for an explicit request or weaken the sandbox.
- [Generic abstractions leak Hindsight details] → keep tool IDs, paths, plugin references, and payload semantics in `packages/agents/opencode`; test core/registry results for provider-neutral fields only.
- [Registry work widens current permissions] → do not change overlay construction in this change; run existing Hindsight negative security tests and compare launch configurations.

## Migration Plan

No data or configuration migration is required. Existing workspaces use automatic selection and retain the current Hindsight/no-provider behavior. The registry is assembled at process startup and does not rewrite OpenCode or VS Code settings. Rollback removes the registry wiring and fake-provider tests while leaving the existing Hindsight adapter, retention controls, lifecycle suppression, and AGENTS.md fallback intact.
