## Why

The OpenCode companion server currently runs outside VS Code's agent sandbox,
so Chat shell tools and MCP descendants do not receive the same filesystem and
network isolation available to native VS Code agents. This change adds an
explicit, Chat-only sandbox control so users can protect the companion without
changing the security behavior of Copilot, the VS Code extension host, or
independent OpenCode CLI/TUI processes.

## What Changes

- Add extension-owned `opencode-chat.chatSandbox.mode` with `inherit`, `on`,
  and `off` values, defaulting to `inherit` at the workspace scope.
- Add extension-owned `opencode-chat.chatSandbox.allowNetwork`, defaulting to
  `true` and only applying when Chat sandboxing is effective.
- Add `Sandbox Chat tools` and `Allow network access` controls to the existing
  Chat settings panel.
- Make `inherit` follow the effective VS Code sandbox-enabled state while
  keeping Chat network access independent from VS Code's network setting.
- Allow a workspace-level `on` override when VS Code's native sandbox is off,
  and a workspace-level `off` override when the native sandbox is on.
- Provide a reset action that returns the workspace to `inherit`.
- Start the OpenCode companion through `@vscode/sandbox-runtime` when Chat
  sandboxing is enabled.
- Apply filesystem isolation to the companion OpenCode server and its shell,
  MCP, LSP, and formatter descendants.
- Support restricted outbound networking and an explicit unrestricted-network
  option for provider, research, and remote MCP access.
- Restart and reinitialize the companion when either Chat sandbox setting
  changes, preserving persisted sessions and UI state.
- Surface sandbox startup, policy, and restart failures without silently
  falling back to an unsandboxed Chat server.
- Preserve the existing Scout/Build overlay, MCP behavior, provider access,
  session handling, and webview lifecycle when sandboxing is disabled.
- Leave VS Code-wide `chat.agent.sandbox.*` settings untouched. The Chat panel
  must not change Copilot's sandbox policy.

## Capabilities

### New Capabilities

- `chat-agent-sandbox`: Optional filesystem and network sandboxing for the
  OpenCode companion server, including settings-panel controls, lifecycle
  behavior, and failure semantics.

### Modified Capabilities

None. Existing companion Scout, MCP, and TUI-handoff requirements remain
unchanged; this change adds a separate Chat process-security capability.

## Impact

- `packages/agents/opencode`: add the sandbox runtime dependency, injected
  launch configuration, sandboxed companion startup, and cleanup lifecycle.
- `packages/platforms/vscode/src`: add Chat sandbox settings ownership,
  runtime configuration, host/webview protocol handling, and reconnect logic.
- `packages/core`: add sandbox status/settings protocol and domain types.
- `packages/platforms/vscode/webview`: add settings-panel controls, status
  handling, workspace configuration updates, and localization.
- `packages/platforms/vscode/package.json` and build output: bundle and verify
  `@vscode/sandbox-runtime` in the extension and VSIX.
- Tests: add agent, extension-host, webview, scenario, and macOS integration
  coverage.

### Scope and Non-goals

This is limited to the OpenCode companion owned by the Chat view. It does not
install or change CLI wrappers, aliases, `OPENCODE_BIN`, sandboxtron, custom
Seatbelt profiles, terminal handoff, independent TUI sessions, or the entire
VS Code process tree.

### Risks and Fallback

- Provider and research requests may fail when Chat network access is disabled;
  the visible Chat network control defaults to enabled when sandboxing is
  effective so the normal research experience is preserved.
- MCPs and OpenCode state may require narrowly scoped filesystem allowances;
  missing permissions must be reported rather than replaced with broad access.
- Runtime or sandbox startup failures must fail closed for an enabled Chat
  sandbox. Users can disable the Chat-specific setting to return to the
  existing unsandboxed companion path.
- The runtime is a preview-oriented dependency and must be pinned, bundled,
  and verified on supported platforms.

### Compatibility Impact

The default `mode: inherit` path follows the effective VS Code sandbox-enabled
state for the current workspace. When the native setting is off, Chat remains
unsandboxed unless the workspace explicitly selects `mode: on`. When the
native setting is on, Chat is sandboxed unless the workspace explicitly
selects `mode: off`. The Chat network default is `true` and is independent of
VS Code's native `allowNetwork` setting.

The new settings are Chat-specific and do not modify VS Code-wide Copilot
settings. Existing CLI, TUI, terminal handoff, MCP configuration ownership,
and independent OpenCode processes remain behaviorally unchanged.

## Corrective Scope: Platform Capability and Local MCPs

Follow-up verification found local MCP failures under the macOS sandbox. The
remediation keeps the sandbox policy independent of workspace identity and MCP
names: local stdio MCP descendants inherit the companion policy, while remote
MCPs follow the configured network policy without receiving filesystem
exceptions. Platform adapters must derive portable OpenCode/runtime paths and
must report missing paths or sandbox violations instead of broadening access.

The platform matrix is deliberately asymmetric. macOS uses narrowly scoped
Mach permissions for required DNS and TLS/provider behavior; Linux uses the
runtime's Linux backend; and unsupported Windows environments report the Chat
sandbox as unavailable while retaining Chat through the existing unsandboxed
launch path. Windows graceful fallback is not a promised sandbox backend, and
no platform may silently grant the whole home directory or a broad projects
tree.
