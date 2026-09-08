## 1. Registry contract and deterministic selection

- [x] 1.1 Add the provider-neutral registry/adapter types and immutable registration path in `packages/agents/opencode`, with validation for stable IDs/descriptors, deterministic ordering, duplicate rejection, and no provider operation during registration. Add focused fake-adapter tests covering automatic selection, explicit provider selection, explicit `none`, malformed/duplicate entries, and thrown detection; verify the existing immutable `none` descriptor remains the fallback.
- [x] 1.2 Preserve the existing `detectMemoryProvider` and `selectMemoryProvider` compatibility helpers while routing the default Hindsight/none discovery through the registry boundary. Verify existing Hindsight state/capability mappings, sanitized reasons, partial capabilities, and automatic-session-retention=false behavior remain unchanged.

## 2. Host integration and replacement-provider boundary

- [x] 2.1 Wire the companion's default memory discovery/status path to the registry with automatic selection while preserving exact Hindsight package resolution, observed-tool gating, sandbox policy, lifecycle-hook suppression, retention policy, AGENTS.md fallback, and independent TUI configuration. Verify no provider is initialized for explicit `none`, unknown selections fail closed, and provider failures do not change Chat/Write startup or sandbox mode.
- [x] 2.2 Add a replacement-provider-shaped fake adapter/integration test that uses no Hindsight identifiers and proves normalized descriptor/status selection through the same registry. Add negative assertions that registration/selection does not add provider tools, wildcard permissions, plugin inheritance, configuration writes, lifecycle retention, or raw provider data to core/protocol/webview boundaries.

## 3. Final validation and scope review

- [x] 3.1 Run focused core/agent/extension tests for the registry and existing memory integration, Biome checks for touched files, `pnpm run build`, strict OpenSpec validation, and `git diff --check`; perform a final scope review confirming no automatic-retention, provider-administration, arbitrary-plugin, AGENTS.md-write, archive, commit, or push behavior was added.
