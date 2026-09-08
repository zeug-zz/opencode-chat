## Why

The detection change now reports whether Hindsight-like capabilities exist, but its discovery input is provider-specific and cannot yet support a replacement backend cleanly. Chat and Write need a stable provider-neutral contract before later changes can explicitly enable memory tools without coupling the core protocol to Hindsight, Supermemory, or any particular MCP/plugin implementation.

## What Changes

- Add a provider-neutral memory capability and descriptor contract.
- Add a provider factory/discovery boundary that can represent Hindsight and future providers.
- Add a safe `none` provider representing the AGENTS.md/context-only fallback.
- Adapt the existing Hindsight detector to the provider boundary without enabling tools or automatic retention.
- Keep provider-specific tool names, configuration, runtime requirements, and payload semantics outside shared core types.
- Add fake-provider tests for normalization, selection, and fallback behavior.

## Capabilities

### New Capabilities

- `memory-provider-contract`: Define provider-neutral memory capabilities, descriptors, factories, and the no-provider fallback used by later companion integration changes.

### Modified Capabilities

None.

## Impact

- Adds shared capability/descriptor types in `packages/core`.
- Adds provider contract and adapter/fallback code in `packages/agents/opencode`.
- Extends existing discovery tests and adds fake-provider contract tests.
- Does not change Chat or Write permissions, launch overlays, sandbox policy, MCP selection, system prompts, webview behavior, configuration files, or runtime dependencies.
- Existing detection status remains compatible; this change adds contract metadata rather than changing the detection state meanings.
