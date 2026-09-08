## Context

See `proposal.md` for motivation and externally visible scope. The current companion builds one static Scout/Build overlay in `packages/agents/opencode/src/opencode-agent.ts` and sends that overlay through both `createOpencodeServer({ config })` and the sandboxed `OPENCODE_CONFIG_CONTENT` environment. The VS Code host currently resolves MCP/guidance and the sandbox filesystem policy before constructing the agent, while memory detection is informational and runs after connection.

The provider contract deliberately keeps shared descriptors free of tool names, paths, credentials, and payloads. The Hindsight coding-agent package is an OpenCode plugin whose safe agent-facing surface is narrower than its complete plugin surface: knowledge-page search/list/read and reflection are read/evidence operations, while ingest/capture, diagnostics, synchronization, and lifecycle hooks have separate effects. Loading the plugin without suppressing its lifecycle hooks would implicitly enable automatic retention, which is outside this change.

## Goals / Non-Goals

**Goals:**

- Resolve and load exactly one approved Hindsight plugin entry without inheriting unrelated global plugins.
- Build one provider-owned, capability-derived overlay consumed by both launch paths.
- Allow only exact Hindsight recall/search and reflection tools to Scout and Build-backed Write.
- Keep automatic retention and all Hindsight write/administrative operations disabled.
- Make sandboxed startup use exact non-conflicting provider read paths and preserve fail-closed behavior.
- Keep provider failure nonfatal while retaining the existing sandbox mode and ordinary AGENTS.md/OpenCode context.

**Non-Goals:**

- Explicit retention confirmation, host-owned retention, lifecycle retention, or provider settings.
- A generic provider registry or a new core protocol field.
- Hindsight deletion, administration, diagnostics, synchronization, or raw provider API access.
- Global plugin inheritance, configuration-file writes, broad home-directory grants, or changes to independent TUI processes.

## Decisions

### 1. Keep provider-specific launch data in the agent adapter

Add an OpenCode-layer Hindsight integration result that contains the approved plugin reference, exact tool patterns, capability-derived permissions, lifecycle environment requirements, and narrow runtime read paths. The shared `MemoryProviderDescriptor` remains metadata-only. The adapter consumes the existing `MemoryProviderStatus`; it does not add Hindsight names or paths to core types.

The resolver will inspect effective configuration layers using the existing read-only configuration-discovery conventions. A plugin entry is approved only when its package identity is exactly the installed Hindsight coding-agent package. For an absolute/local entry, package metadata is checked before the entry is used; for a package specifier, only the exact approved package name is accepted. Tuple options and all unrelated entries are discarded. A merely Hindsight-like string is not sufficient.

This is preferred over forwarding the entire plugin list because plugin initialization can have effects before tool permissions are evaluated. It is also preferred over dynamically importing the plugin in the extension host because OpenCode must own plugin initialization and the extension must not duplicate provider runtime state.

### 2. Resolve the provider before companion launch and verify tools after launch

The host will resolve the approved entry and construct the launch configuration before the first companion connection. After the server is ready, a non-mutating tool inventory check will confirm which exact Hindsight tools are actually registered. The existing normalized detection status will be produced from those independently observed tools, rather than from a plugin name alone.

If preflight resolution or post-launch inventory fails, the host will retry or retain the base companion overlay in the same requested sandbox mode and publish a sanitized unavailable/blocked/error status. It will never turn a sandboxed request into an unsandboxed launch as a recovery action.

### 3. Use an exact, capability-derived tool allowlist

The adapter maps `recall` to `hindsight_search_knowledge_pages`, `hindsight_list_knowledge_pages`, and `hindsight_read_knowledge_page`, and maps `reflect` to `hindsight_reflect`. Permissions are added only when the corresponding detected capability is true. No `hindsight_*` wildcard is used. `hindsight_ingest_document`, `hindsight_capture_initiative`, `hindsight_diagnose`, `hindsight_sync_status`, deletion names, provider administration, and unknown names remain covered by the existing wildcard denial.

The same permission fragment is merged into Scout and Build while preserving Scout’s exact worker-only task rule and Build’s deny-by-default editing boundary. Retention capability may still be reported by discovery, but it does not authorize a tool in this change; the later retention-controls change owns that policy.

### 4. Disable provider lifecycle hooks for the companion

The companion process will receive `HINDSIGHT_DISABLE_HOOKS=1` whenever the Hindsight plugin is enabled. This preserves the plugin’s explicit read/reflect tool registration while preventing automatic seed, prompt injection, transcript write-back, and idle retention. The variable is process-scoped: the SDK-managed server receives it through a narrowly scoped environment handoff and the sandboxed child receives it in its explicit child environment. Any temporary host-environment mutation is restored after server creation and is never sent through the webview or persisted.

This is preferred over changing the user’s Hindsight configuration because the independent TUI must keep its own lifecycle behavior. It is also preferred over relying on permission denial alone, because lifecycle hooks can perform writes without an agent tool call.

### 5. Extend the existing sandbox policy only with exact provider paths

When sandboxing is enabled, the host will pass the resolved Hindsight package root and only the exact configuration/runtime read files required for plugin initialization into the existing filesystem-policy builder. The builder will normalize, deduplicate, and check these paths against the reviewed deny-read baseline before launch. Provider paths that cannot be resolved, are unsupported, or conflict with a protected deny path make the provider blocked; they do not broaden the home grant or disable the sandbox.

The provider’s network requirement will continue to use the existing Chat network setting and network policy. This change adds no new network rule. Provider logging, if needed for startup, will use an already permitted OpenCode temporary path rather than an unrestricted system path.

### 6. Preserve both existing launch paths from one overlay value

`OpenCodeAgent` will accept the provider integration as part of its launch configuration and pass the same normalized overlay to the SDK server config and the sandbox child’s `OPENCODE_CONFIG_CONTENT`. Tests will compare the resulting plugin reference, agent permissions, MCP configuration, guidance configuration, and lifecycle environment. No user/workspace config is written, and the independent TUI does not receive the companion-only overlay.

## Risks / Trade-offs

- [Approved plugin path is unavailable in the sandbox] → mark Hindsight blocked and keep the same-sandbox ordinary companion rather than weakening the policy.
- [Plugin tool inventory differs across Hindsight versions] → expose only exact tools observed at runtime; partial capability status is retained and unknown tools remain denied.
- [SDK server creation has no per-call environment option] → use a bounded process-environment handoff for the managed child, restore it immediately, and assert the lifecycle-disable variable in tests.
- [Provider startup failure could hide an otherwise usable companion] → retry the same launch mode with the base overlay and publish a sanitized provider failure; never use an unsandboxed fallback for a sandbox request.
- [Adding Hindsight permission rules could accidentally widen Write] → require wildcard denial and exact allowlist assertions for both agents, including explicit negative checks for every write, admin, shell, task, package, and terminal pattern.
- [Provider results may contain prompt injection or sensitive content] → preserve existing source-provenance guidance and keep provider errors/statuses out of the webview except through bounded sanitized status fields.

## Migration Plan

No data or configuration migration is required. Existing users without an approved Hindsight entry continue to receive the current Scout/Build overlay and AGENTS.md/OpenCode context. Users with an approved entry gain the companion overlay only after capability and sandbox checks succeed; their independent TUI configuration is untouched.

Rollback removes the provider integration from the launch configuration and the exact permission additions. The base agent, MCP, guidance, sandbox, and protocol behavior remains usable without cleanup. If a rollout encounters provider incompatibility, the runtime fallback disables only the companion provider overlay in the same sandbox mode and reports the sanitized state.
