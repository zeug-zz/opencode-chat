## Context

The preceding `detect-memory-provider-capabilities` change introduced shared `MemoryProviderStatus` state and a Hindsight-oriented discovery abstraction. That status is useful for reporting but is not a stable extension point for future memory backends. This change introduces the contract only; the following tool-enablement change will decide how an approved provider is added to companion launch profiles.

## Contract layers

Keep three layers separate:

1. **Shared metadata in `packages/core`**: operation names, capability flags, provider descriptor, and no-provider metadata. These types must not contain provider credentials, URLs, paths, tool names, or payload schemas.
2. **Provider selection in `packages/agents/opencode`**: injectable factories and deterministic selection with a `none` fallback.
3. **Provider adapters**: Hindsight-specific mapping from existing detection status to normalized metadata. Later adapters may represent MCP, plugin, local-file, database, or hosted providers.

Suggested shared types:

```ts
type MemoryOperation = "retain" | "recall" | "reflect";

type MemoryCapabilities = {
  retain: boolean;
  recall: boolean;
  reflect: boolean;
  automaticSessionRetention: boolean;
};

type MemoryProviderDescriptor = {
  id: string;
  displayName: string;
  capabilities: MemoryCapabilities;
  requiresNetwork: boolean;
  requiresLocalRuntime: boolean;
};
```

The descriptor may include normalized capability metadata but must not include provider-specific tool patterns yet. Tool allowlists belong to the later explicit companion-tool change and remain adapter-owned.

## Factory boundary

Use an injected factory interface that can report a descriptor or no provider. The selector should iterate factories in declared order, catch and normalize factory failures, and choose `none` when no factory succeeds. The selector must not dynamically scan or initialize arbitrary user plugins.

The `none` provider should be a constant or immutable factory result. It communicates that ordinary OpenCode context and AGENTS.md guidance remain available but does not imply durable memory.

The Hindsight adapter should consume the existing `MemoryProviderStatus` and map its three detection flags to the normalized `MemoryCapabilities`. Automatic session retention is false until separately verified. Network/local-runtime requirements should be conservative metadata only and must not alter sandbox policy in this change.

## Compatibility and migration

Keep `MemoryProviderStatus` and the `memoryStatus` protocol message unchanged. Add new contract types alongside them and avoid changing existing detection states. Existing callers of `detectMemoryProvider` continue to work. Export the new agent-layer contract only from the existing package entry point.

No launch configuration field, permission map, MCP overlay, sandbox grant, or webview message is added here. The next tool-enablement change can consume the descriptor and add those behaviors under a separate security review.

## Testing

Use fake factories and provider statuses. Cover deterministic first-success selection, factory exceptions, all-unavailable fallback, independent capability mapping, automatic retention remaining false, and absence of provider-specific secrets/tool configuration from shared descriptors. Add a regression test proving existing Hindsight detection behavior and existing launch configuration shapes remain unchanged.

## Non-goals

- Enabling Hindsight or any memory tool for Chat or Write.
- Automatic or host-owned session retention.
- Provider configuration UI or configuration writes.
- Plugin loading or global plugin inheritance.
- Sandbox filesystem/network grants.
- MCP changes.
- Generic provider settings persistence.
