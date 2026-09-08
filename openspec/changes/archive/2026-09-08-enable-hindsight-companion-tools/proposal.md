## Why

The companion now detects and describes an approved memory provider, but Chat and Write still cannot use the Hindsight capabilities that are available to the OpenCode TUI. This change closes that gap through an explicit, capability-gated Hindsight integration without inheriting unrelated global plugins or weakening the existing agent and sandbox boundaries.

## What Changes

- Resolve only the approved Hindsight coding-agent integration from the effective OpenCode configuration; never copy the complete global plugin list or arbitrary plugin options into the companion.
- Add a provider-owned, process-scoped Hindsight overlay that is applied identically to the SDK-managed unsandboxed server and the sandboxed `OPENCODE_CONFIG_CONTENT` launch.
- Expose only the verified non-administrative Hindsight recall/search and reflection tools, with exact tool-name allowlists derived from detected capabilities.
- Allow those tools explicitly to both Scout/Chat and Build-backed Write while retaining wildcard denial for shell, editing escalation, task recursion, package/terminal control, deletion, provider administration, and unknown tools.
- Resolve the narrow read-only plugin/runtime paths needed by the approved integration under the existing sandbox policy; report the provider as blocked and preserve normal Chat/Write operation when those boundaries cannot be applied safely.
- Keep failures nonfatal, preserve the independent TUI configuration, and leave explicit retention/write tools and automatic session retention for a later retention-controls change.

## Capabilities

### New Capabilities

- `hindsight-companion-tools`: Explicitly enable safe Hindsight recall/search and reflection for the companion’s Chat and Write agents through a capability-gated, sandbox-aware, process-scoped integration.

### Modified Capabilities

- `companion-scoped-scout`: Extend the existing Chat/Write permission contract with the approved exact Hindsight read/reflect tools while preserving all existing denial and delegation boundaries.

## Scope and Non-goals

This change covers Hindsight plugin resolution, the companion overlay, capability-gated recall/reflect tool visibility, Chat/Write permission rules, sandbox parity, and focused security/regression tests. It does not implement explicit retention confirmation, automatic session retention, provider settings, deletion, provider administration, generic-provider registration, webview controls, configuration-file writes, arbitrary plugin inheritance, or new dependencies.

## Risks, Fallback, and Compatibility

The primary risks are plugin identity confusion, unsafe tool-pattern expansion, sandbox path leakage, and different behavior between launch paths. Exact approved identity, exact tool names, redacted errors, deterministic overlay construction, and fail-closed sandbox overlap checks mitigate them. If Hindsight resolution, capability verification, or sandbox preparation fails, the companion must retain its existing Scout/Build behavior and AGENTS.md/ordinary OpenCode context; it must not silently launch unsandboxed. Removing this change’s overlay and permission additions restores the current behavior without migration. Independent TUI configuration and all existing Chat MCP, guidance, delegation, model-selection, and workspace policies remain unchanged.

## Impact

Affected areas are the OpenCode agent launch configuration and Hindsight adapter, VS Code activation/sandbox policy wiring, companion permission tests, launch-parity tests, and the corresponding OpenSpec capability delta. The new capability consumes the existing sandbox policy and adds only an exact provider runtime read boundary when safely resolvable; no persisted schema, protocol payload, user configuration file, dependency, or independent TUI process is changed.
