## 1. Settings and Contracts

- [x] 1.1 Contribute `opencode-chat.chatSandbox.mode` with `inherit`, `on`, and
  `off` values and `opencode-chat.chatSandbox.allowNetwork` with a `true`
  default at workspace scope; verify the extension manifest exposes both
  settings without modifying `chat.agent.sandbox.*`.
- [x] 1.2 Add the pinned `@vscode/sandbox-runtime` dependency to the OpenCode
  agent package and update the lockfile; verify dependency resolution succeeds
  without installing a CLI wrapper.
- [x] 1.3 Add core types for configured mode, effective enabled state,
  inherited state, allowNetwork, applying, managed, supported, and error
  fields; verify strict TypeScript compilation.
- [x] 1.4 Extend the core UI/host protocol with an atomic sandbox settings
  update message and sandbox status messages; verify all protocol switch sites
  remain exhaustive.
- [x] 1.5 Define the injected OpenCode launch configuration boundary without
  importing `vscode` into the agent package; verify existing non-VS-Code agent
  package tests still compile.

## 2. Sandboxed Companion Launcher

- [x] 2.1 Implement normalized Chat sandbox settings loading and validation in
  the VS Code host; verify `inherit` resolves to the effective native VS Code
  sandbox state, `on` and `off` override it per workspace, and invalid values
  never enable sandboxing.
- [x] 2.2 Implement deterministic filesystem policy construction for the active
  workspace, OpenCode configuration/state paths, runtime caches, temporary
  paths, loopback binding, and explicitly enabled MCP paths; verify the policy
  does not include broad home-directory or credential-store access.
- [x] 2.3 Implement network policy mapping so Chat `allowNetwork: true` is the
  default whenever effective mode is sandboxed, while `false` denies
  non-loopback outbound access without removing filesystem restrictions; verify
  both configurations independently from native VS Code network settings.
- [x] 2.4 Add the sandboxed companion launch path using the runtime manager and
  explicit `opencode serve` loopback arguments with port `0`; verify the
  resulting child command and environment are safely quoted and spawned
  without a host shell injection path.
- [x] 2.5 Preserve the existing Scout and Build `OPENCODE_CONFIG_CONTENT`
  overlay in the sandboxed child environment; verify Scout remains read-only
  and Build retains its current permitted operations.
- [x] 2.6 Preserve the existing SDK client and SSE event behavior after the
  sandboxed server announces readiness; verify the client uses the discovered
  loopback URL and existing event mapping.
- [x] 2.7 Keep the existing SDK startup path when Chat sandboxing is disabled;
  verify the default path does not initialize the sandbox runtime and retains
  current behavior.
- [x] 2.8 Capture child stdout, stderr, startup errors, early exits, and
  readiness timeouts; verify errors include actionable connection details and
  never start an unsandboxed replacement when sandboxing is enabled.
- [x] 2.9 Implement async child and runtime cleanup for disconnect, failed
  startup, unexpected exit, and final extension disposal; verify no child or
  runtime helper remains after cleanup.
- [x] 2.10 Preserve event listeners across a settings-driven reconnect while
  clearing them on final disposal; verify events continue reaching the same
  Chat provider after restart.

## 3. Host Settings Controller

- [x] 3.1 Load Chat-specific mode and network settings plus the effective native
  sandbox-enabled value before the initial companion connection; verify
  activation resolves `inherit` before any webview message arrives.
- [x] 3.2 Implement workspace-target updates for Chat mode and network settings,
  including removal of the mode override for reset-to-inherit; verify panel
  changes persist and native VS Code `chat.agent.sandbox.*` settings remain
  unchanged.
- [x] 3.3 Add a serialized host controller for sandbox setting changes; verify
  concurrent updates result in one ordered companion transition.
- [x] 3.4 During a transition, publish applying status, block new Chat requests,
  stop the old companion, and start exactly the requested normal or sandboxed
  path; verify no old process remains serving requests.
- [x] 3.5 Refresh sessions, active messages, providers, agents, MCP status, and
  sandbox status after a successful reconnect; verify existing MCP preferences
  are reapplied without writing `opencode.json`.
- [x] 3.6 Listen for Chat-specific configuration changes made outside the panel
  and native sandbox-enabled changes only when Chat mode is `inherit`; route
  both through the same serialized transition and verify duplicate events do
  not cause duplicate restarts.
- [x] 3.7 Surface managed-setting, runtime initialization, startup, and
  reconnect failures to the panel and VS Code error path; verify effective
  sandbox failures remain unavailable rather than falling back unsandboxed.
- [x] 3.8 Remove the sandboxed path's dependency on global `process.chdir()` and
  pass the workspace directory directly to the child; verify extension-host
  process cwd is restored and remains stable.

## 4. Provider and Webview Integration

- [x] 4.1 Refactor ChatViewProvider initialization into a reusable refresh method
  that can run after reconnect; verify a webview remount is not required to
  receive fresh sessions, providers, agents, and MCP data.
- [x] 4.2 Handle the atomic sandbox settings message in the host provider and
  return effective status after the controller applies the change; verify
  failed updates report the previous effective state.
- [x] 4.3 Add sandbox status to the webview initialization flow and handle later
  status updates; verify the panel reflects activation-time settings before
  the user opens it.
- [x] 4.4 Add `Sandbox Chat tools`, `Allow network access`, inherited-state, and
  reset-to-VS-Code controls to ToolConfigPanel, including disabled
  subordinate-network behavior and clear local-only/network-enabled
  descriptions; verify existing MCP, language, sound, and config-link controls
  remain intact.
- [x] 4.5 Wire sandbox status and settings callbacks through App and InputArea;
  verify changes are sent through the typed protocol rather than webview-only
  persistence.
- [x] 4.6 Add localized sandbox labels, descriptions, status text, and error
  text for every supported locale; verify locale tests cover the new keys.
- [x] 4.7 Disable sandbox controls while a companion transition is active and
  prevent unsafe changes during active requests; verify the UI recovers after
  successful and failed transitions.

## 5. Automated Tests

- [x] 5.1 Add agent unit tests for effective off and on launch paths, workspace
  cwd, command arguments, environment overlay, readiness, and SDK client
  creation; verify no runtime is initialized when effective mode is off.
- [x] 5.2 Add agent lifecycle tests for startup failure, early exit, disconnect,
  reconnect, listener preservation, and final disposal; verify all child and
  runtime cleanup paths.
- [x] 5.3 Add host tests for inherit/on/off resolution, Chat network default,
  workspace target updates, reset-to-inherit, native-setting isolation,
  managed settings, serialized transitions, and fail-closed errors.
- [x] 5.4 Add ChatViewProvider protocol tests for initial sandbox status,
  settings updates, transition status, refresh after reconnect, and error
  reporting.
- [x] 5.5 Add ToolConfigPanel component tests for both checkboxes, network
  subordinate state, labels, status states, and callback payloads.
- [x] 5.6 Add webview scenario coverage for inherited native-on and native-off
  states, workspace enable/disable/reset, local-only mode, network-enabled
  mode, restarting, and preserving other settings-panel behavior.
- [x] 5.7 Add macOS integration coverage for workspace access, denied paths,
  loopback connectivity, network-off denial, network-on provider access, and
  child/MCP inheritance.

## 6. Build and Verification

- [x] 6.1 Verify the runtime is bundled by the extension esbuild entrypoint and
  does not require a separately installed executable; inspect the built
  extension output for the runtime entry points.
- [x] 6.2 Run focused agent, host, webview, and scenario tests; record any
  platform-specific skips explicitly.
- [x] 6.3 Run `npm run check` and resolve formatting, lint, and type issues.
- [x] 6.4 Run `npm run build` and verify the extension and webview build outputs.
- [x] 6.5 Run `npm run package`, install the VSIX, and verify Chat sandbox
  controls and runtime startup in a macOS VS Code instance.
- [x] 6.6 Run OpenSpec validation and confirm the implementation satisfies every
  inherit/on/off and network scenario in `specs/chat-agent-sandbox/spec.md`.
- [x] 6.7 Update the main `openspec/specs/chat-agent-sandbox/spec.md` only after
  implementation and verification are complete; confirm no CLI/TUI sandbox
  artifacts were added to this change.

## 7. Corrective Remediation: Platform and Local MCP Verification

- [x] 7.1 Add platform capability detection before resolving an effective
  sandbox launch; verify macOS and Linux use supported runtime backends, while
  Windows reports sandboxing as unsupported and keeps Chat available through
  the existing unsandboxed launch path without claiming that sandboxing is
  active.
- [x] 7.2 Define and implement a portable runtime-path policy for OpenCode
  configuration, state, cache, temporary files, executable resolution, and
  local stdio MCP descendants; verify policy inputs are derived per platform,
  local MCPs inherit the companion sandbox, and missing paths fail visibly
  rather than expanding access to a home-directory root or broad project tree.
- [x] 7.3 Add macOS adapter coverage for the narrow Mach permissions required
  for DNS resolution and TLS/provider connectivity; verify these permissions
  do not become broad wildcard network or filesystem allowances and that Linux
  uses the runtime's Linux backend instead of macOS-specific permissions.
- [x] 7.4 Capture and surface sandbox violations and MCP child diagnostics,
  including denied filesystem/network operations, child stderr/stdout, exit
  status, and startup/readiness context; verify failures identify the affected
  companion or MCP without leaking secrets.
- [x] 7.5 Run focused unit and integration coverage for capability resolution,
  portable paths, local stdio MCP inheritance, macOS DNS/TLS behavior, Linux
  backend selection, Windows graceful fallback, and violation diagnostics;
  perform live macOS verification with representative local and remote MCP
  configurations and record platform-specific results.
- [x] 7.6 After remediation verification, update the main
  `openspec/specs/chat-agent-sandbox/spec.md` from this delta and rerun strict
  OpenSpec validation; preserve this change's completed history and leave all
  corrective tasks unchecked until their implementation and verification are
  complete.
