## Why

The OpenCode Research companion currently replaces the normal plugin surface with
an in-memory overlay that excludes the user's global and project plugins. This
prevents Context Mode and other user-installed research integrations from
working in Chat, even though the compatibility sandbox is intentionally generic
enough to support installed runtimes and MCP descendants.

OpenCode's plugin surface is expanding, and the companion should preserve the
same native plugin discovery model as the user's OpenCode process while keeping
its own agent permissions, sandbox write boundary, and independent TUI
configuration isolated.

## What Changes

- Inherit OpenCode's native global/project plugin sources in the companion-owned
  server, including configured plugin entries and supported plugin-directory
  discovery.
- Preserve plugin entries and tuple options as opaque configuration data; do not
  copy the complete OpenCode configuration or execute plugins during preflight.
- Apply equivalent plugin loading to SDK-managed and sandboxed companion starts.
- Keep the existing Scout, Build-backed Write, and delegated research-worker
  agent permission boundaries unchanged.
- Allow the native Context Mode tool prefix to the existing read-only research
  worker while retaining the separate MCP prefix and denying generic plugin
  tools to the worker.
- Reuse the compatibility sandbox's generic read behavior and existing bounded
  write/runtime paths instead of adding per-plugin filesystem grants.
- If inherited plugin loading prevents startup or readiness, retry once with an
  explicit plugin-free overlay while preserving the requested sandbox, network,
  MCP, guidance, and agent policies. Never retry unsandboxed.
- Keep plugin failures and diagnostics bounded and redacted, and leave ordinary
  Chat/Write operation usable when the plugin-free fallback succeeds.
- Keep Hindsight's exact identity, capability, observed-tool, lifecycle, and
  permission gates even though Hindsight is now part of the inherited plugin
  surface.
- Document that inherited plugins are trusted code running inside the companion
  process and are not isolated like separate MCP children.

## Capabilities

### New Capabilities

- `companion-plugin-runtime`: Native plugin inheritance, launch parity, generic
  sandbox compatibility, and nonfatal plugin-startup fallback for the
  extension-owned OpenCode server.

### Modified Capabilities

- `companion-scoped-scout`: Preserve agent boundaries while exposing the native
  Context Mode tool prefix only to the read-only research worker.
- `chat-agent-sandbox`: Treat inherited plugin code as part of the existing
  compatibility process boundary without adding plugin-specific grants or
  weakening constrained writes.
- `hindsight-companion-tools`: Keep Hindsight capability gating independent from
  the broader inherited plugin surface.

## Impact

- `packages/agents/opencode/src/launch-config.ts` and
  `packages/agents/opencode/src/opencode-agent.ts`: carry plugin sources through
  both launch paths, compose the overlay without dropping native discovery, and
  implement the bounded plugin-free retry.
- `packages/agents/opencode/src/hindsight-plugin-resolver.ts` and the VS Code
  activation path: distinguish inherited plugin loading from Hindsight-specific
  detection and permission derivation.
- `packages/platforms/vscode/src/chat-sandbox-policy.ts`: retain generic
  compatibility reads and constrained writes without adding plugin-name policy.
- Agent, sandbox, extension-host, integration, and documentation tests: cover
  plugin source parity, tool boundaries, failure fallback, and independent TUI
  isolation.
- OpenSpec security and sandbox requirements: replace the current blanket
  no-plugin-inheritance contract with process-scoped inherited-plugin behavior.

## Scope and Non-goals

- This change does not copy arbitrary global agent, permission, provider, model,
  MCP, or command configuration into the companion; plugin sources are the
  intentional exception.
- It does not grant Scout or Write edit, shell, package, terminal, arbitrary
  task, or unrestricted plugin-tool capabilities.
- It does not give plugins arbitrary home-directory writes or remove protected
  sandbox read denials.
- It does not modify independent OpenCode TUI/CLI configuration or lifecycle.
- It does not add a plugin marketplace, plugin management UI, or plugin-specific
  settings panel.
- It does not isolate in-process plugin hooks from the companion; users are
  explicitly trusting installed plugins when they enable this behavior.

## Risks, Fallback, and Compatibility

The primary risk is that an inherited plugin is executable code inside the
companion process. It can register tools and hooks and may observe or transform
OpenCode events; agent permission rules do not provide process isolation. The
compatibility sandbox still applies its protected read and constrained write
policy, and documentation must describe the resulting trust boundary.

A plugin that requires an unavailable or denied write path may fail during
startup. The companion will retry once with an explicit empty plugin list in the
same sandbox mode. If that fallback starts, Chat remains available and the
failure is reported only through bounded diagnostics. A plugin failure after
startup remains an operation-level failure and must not trigger an unsandboxed
retry.

Existing users who do not configure plugins retain the current companion
behavior. Users who already configure plugins will see those plugins in the
companion after restart, without any configuration-file writes. The independent
TUI remains unchanged.
