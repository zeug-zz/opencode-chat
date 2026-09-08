## Why

The companion now has a provider-neutral capability contract, an explicit Hindsight adapter, and a safe `none`/AGENTS.md fallback, but provider discovery is still hard-wired to one detector path. A replacement memory backend cannot be registered, selected, or tested through the same sanitized boundary without either coupling the host to Hindsight or reintroducing arbitrary plugin inheritance. This is the next planned step now that the Hindsight-only integration and fallback behavior are implemented and verified.

## What Changes

- Add a provider-neutral registry/adapter boundary in the OpenCode agent layer for approved memory providers.
- Make registration deterministic and reject duplicate, malformed, or unsafe provider entries without loading provider code or writing configuration.
- Provide explicit provider selection semantics for automatic selection, the `none` fallback, and an unknown/unavailable provider, with sanitized status results.
- Register the existing Hindsight detector/adapter through the registry without changing its exact package, capability, tool, sandbox, or lifecycle-hook gates.
- Keep the immutable `none` provider as the context-only AGENTS.md fallback and preserve ordinary Chat/Write startup when no provider is usable.
- Add a fake provider contract/integration fixture proving a replacement provider can be registered and selected without Hindsight-specific types or tool names in `packages/core`.
- Preserve the existing typed status boundary and prevent provider internals, credentials, raw errors, arbitrary plugin loading, or provider configuration writes from crossing it.

## Capabilities

### New Capabilities

- `memory-provider-registry`: Register and select approved provider adapters through a deterministic, provider-neutral boundary with a safe `none` fallback.

### Modified Capabilities

None. The existing provider-neutral contract remains compatible; the registry adds a new selection capability around it.

## Scope and Non-goals

This change covers registry ownership, provider registration, selection precedence, sanitized fallback status, and fake replacement-provider coverage. It does not add a new Hindsight tool, enable automatic session retention, change retention policy defaults, inherit arbitrary global plugins, add provider administration or deletion, write OpenCode/provider configuration, promote findings into `AGENTS.md`, or redesign the existing Hindsight sandbox and permission gates.

## Risks, Fallback, and Compatibility

The main risks are duplicate or ambiguous provider selection, accidental dynamic plugin loading, and making a replacement provider bypass the existing sandbox or permission boundary. Registration is therefore code-owned and explicit, selection is deterministic, provider errors are sanitized and nonfatal, and every unusable or disabled selection resolves to the existing `none`/AGENTS.md context fallback. Existing Hindsight discovery, Chat/Write overlays, retention controls, automatic-retention suppression, independent TUI configuration, and webview status shapes remain backward-compatible; existing callers of `detectMemoryProvider` and `selectMemoryProvider` continue to work.

## Impact

Affected areas are the provider-discovery/adapter code and tests in `packages/agents/opencode`, the provider-neutral descriptor/selection types in `packages/core` if required, and focused extension tests that verify host startup uses the registry without changing the current Hindsight behavior. No dependency, migration, user configuration rewrite, or new runtime permission is required.
