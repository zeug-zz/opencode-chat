# VS Code Chat Agent Sandbox

## Status

Proposed implementation plan for the VS Code Chat companion only.

## Decision Summary

Add an optional Chat sandbox control to the existing gear settings panel. The
control uses a workspace-scoped Chat mode that inherits the effective VS Code
agent sandbox state by default, while allowing an explicit workspace `on` or
`off` override. The effective Chat policy is applied to the OpenCode companion
server through `@vscode/sandbox-runtime`.

The settings panel will expose two related controls:

- `Sandbox Chat tools`: shows the effective sandbox state and lets the user
  select `inherit`, `on`, or `off` for the active workspace.
- `Allow network access`: permits unrestricted outbound network access while
  the filesystem sandbox remains active. It defaults to enabled whenever Chat
  sandboxing is effective.

The second control is visible rather than hidden because unrestricted network
access permits provider, research, and remote MCP traffic, but also permits
data exfiltration from files available inside the sandbox.

VS Code's native sandbox-enabled setting is only the default for Chat's
`inherit` mode. Chat's network setting is independent of VS Code's native
network setting. The panel persists Chat's workspace policy and never changes
VS Code-wide Copilot settings.

## Scope

### In scope

- Sandboxing the OpenCode companion server used by the VS Code Chat view.
- Applying the sandbox to OpenCode shell tools, local MCP servers, LSPs,
  formatters, and other descendants of the companion server.
- Reading the effective native sandbox-enabled setting for `inherit` mode.
- Reading and updating workspace-scoped Chat sandbox settings.
- Displaying sandbox and network state in `ToolConfigPanel`.
- Restarting the companion safely when sandbox mode changes.
- Preserving Scout, Build, MCP, provider, session, and research behavior.
- Unit, scenario, extension-host, and macOS integration coverage.

### Out of scope

- Sandboxing ordinary `opencode` CLI commands.
- Sandboxing the independent OpenCode TUI or handoff process.
- `OPENCODE_BIN`, shell aliases, `sandboxtron`, custom Seatbelt profile files,
  or CLI wrapper installation.
- Sandboxing the entire VS Code application or extension host.
- Replacing OpenCode's own permission model.
- Changing VS Code-wide `chat.agent.sandbox.*` settings or Copilot behavior.

The wider CLI/TUI Seatbelt work remains independent and must not be required
for this feature.

## Security Boundary

The target process tree is:

```text
VS Code extension host
  +-- sandboxed opencode serve
        +-- OpenCode shell tools
        +-- local MCP processes
        +-- LSP and formatter processes
```

The extension host, webview, other VS Code extensions, and Electron services
remain outside the sandbox. The OpenCode server and processes it launches are
inside the sandbox.

The built-in VS Code setting does not automatically wrap arbitrary extension
child processes. `opencode-chat` must explicitly use the sandbox runtime when
starting its companion server.

The sandbox is defense in depth, not a credential boundary:

- Network access can expose any data readable by the sandboxed process.
- Provider credentials inherited by the server remain available to the server
  and potentially to its descendants.
- Files explicitly allowed by the filesystem policy remain accessible.
- A sandbox denial must never cause the extension to silently retry the same
  operation outside the sandbox.

## User Experience

### Settings panel

Add a `Sandbox` section to the existing `ToolConfigPanel`, alongside language,
sound, and MCP settings.

The section contains:

```text
Sandbox Chat tools                 [on/off]
  Inherited from VS Code / Workspace override

Allow network access                [on/off]
  Required for providers, web research, and remote MCP servers.
```

The network control is disabled when the effective Chat sandbox is off. Its
workspace value is preserved so that turning the sandbox back on restores the
user's previous network choice. The default value is `true`, so a sandboxed
Chat has provider and research access unless the user explicitly chooses
local-only operation.

The panel must show both configured mode and effective state received from the
extension host, not an assumed default. This handles VS Code version defaults,
user settings, workspace settings, and managed settings correctly.

When the workspace mode is `inherit`, the checkbox reflects the native VS Code
sandbox-enabled value. Checking or unchecking the control creates a workspace
override of `on` or `off`. A `Use VS Code setting` reset action removes the
workspace override and returns to `inherit`.

The panel should explain the practical modes:

- Inherit with native sandbox off: current companion behavior, without runtime
  sandboxing.
- Inherit with native sandbox on: Chat is sandboxed and network access defaults
  to enabled for the Chat companion.
- Workspace `on`: Chat is sandboxed even when native VS Code sandboxing is off.
- Workspace `off`: Chat is unsandboxed even when native VS Code sandboxing is
  on.
- Sandboxed Chat with network off: local Chat tools and files only; provider and
  research requests are expected to fail.
- Sandboxed Chat with network on: filesystem restrictions remain active and
  outbound network access is unrestricted.

If the sandbox is enabled but network access is disabled, the UI should not
claim that research is available without qualification. The existing model and
research controls remain usable, but network-dependent requests may return a
sandbox denial.

### Chat setting mapping

Contribute and use these extension-owned settings:

- `opencode-chat.chatSandbox.mode`: `inherit`, `on`, or `off`, default
  `inherit`, scoped to the active workspace.
- `opencode-chat.chatSandbox.allowNetwork`: boolean, default `true`, scoped to
  the active workspace.

Resolve the effective mode as follows:

- `inherit` follows `chat.agent.sandbox.enabled` only for the Chat sandbox
  enabled state.
- `on` enables Chat sandboxing regardless of the native enabled state.
- `off` disables Chat sandboxing regardless of the native enabled state.
- Chat `allowNetwork` is independent of
  `chat.agent.sandbox.allowNetwork` and defaults to `true` whenever Chat is
  sandboxed.

The extension host reads the Chat settings and the native enabled state before
connecting the companion. The settings panel sends workspace-setting changes
to the host, and the host updates only the extension-owned settings. The panel
must not maintain a conflicting sandbox policy in `UIPersistedState`.

If a workspace setting is managed or cannot be changed, the panel must display
the effective value and disable the corresponding control rather than
suggesting that the change succeeded. Native setting changes must refresh Chat
only when the Chat mode is `inherit`.

## Current Repository Gap

`packages/agents/opencode/src/opencode-agent.ts` currently calls
`createOpencodeServer({ port: 0, config: ... })`. The SDK helper already starts
an OpenCode child process, but it does not expose the custom executable,
sandbox wrapping, or child process options needed here.

The extension host currently changes its own working directory around
`agent.connect()` in `packages/platforms/vscode/src/extension.ts` because the
SDK helper has no `cwd` option. The sandboxed launch path must pass `cwd` to the
child directly and must not retain a global `process.chdir()` workaround.

The existing webview settings infrastructure is suitable for the UI:

- `ToolConfigPanel` already renders checkbox-based MCP controls.
- `App.tsx` owns panel state and passes settings props into `InputArea`.
- `core/src/protocol.ts` defines the UI-to-host and host-to-UI message unions.
- `UIPersistedState` currently stores UI preferences, but should not become
  the authority for Chat process policy. Workspace configuration belongs to the
  extension host.

The extension connects the agent before the webview sends `ready`, so the
host must resolve the Chat workspace mode and native sandbox state during
activation. A webview-only toggle cannot be the initial source of truth.

## Runtime Integration

### Dependency

Add a pinned compatible version of `@vscode/sandbox-runtime` to the package
that owns `OpenCodeAgent`. The current extension build bundles workspace agent
source and its dependencies through `packages/platforms/vscode/esbuild.mjs`.

Verify that the runtime and its required files are included in the extension
bundle and VSIX. The extension host targets Node 22, which satisfies the
runtime's Node requirement, but the package is still preview-oriented and its
API must be pinned and tested.

### Agent options

Keep the agent package independent of the VS Code API. Introduce an injected
launch/configuration object containing:

- The resolved real OpenCode executable for the companion.
- The selected workspace directory.
- The configured `inherit | on | off` mode.
- The resolved effective sandbox state.
- Chat filesystem rules.
- Chat network rules, defaulting to unrestricted outbound access when the
  effective sandbox is on unless the workspace explicitly disables it.
- The existing in-memory Scout and Build configuration overlay.

The extension host reads VS Code configuration and passes this object to the
agent. The agent must not import `vscode` or read VS Code settings directly.

### Normal mode

When the resolved Chat sandbox state is `off`, preserve the current companion
startup behavior as closely as possible. Existing Scout/Build configuration,
SDK client setup, SSE handling, and MCP behavior must remain unchanged.

### Sandboxed mode

When the effective sandbox state is on:

1. Initialize the process-scoped `SandboxManager` before starting the server.
2. Translate the Chat filesystem and network settings into a
   `SandboxRuntimeConfig`.
3. Build a safely quoted `opencode serve` command with explicit loopback
   hostname and port `0`.
4. Use `SandboxManager.wrapWithSandboxArgv()` to obtain the child command and
   environment.
5. Spawn the wrapped command without passing untrusted command text through a
   host shell. The runtime API's macOS command representation must be quoted
   safely before it is spawned.
6. Set the child `cwd` to the selected workspace.
7. Set `OPENCODE_CONFIG_CONTENT` to the same in-memory Scout/Build overlay used
   by the current SDK path. Do not place credentials in the overlay.
8. Capture stdout and stderr while waiting for the OpenCode listening
   announcement.
9. Create the SDK client against the discovered loopback URL.
10. Subscribe to events using the existing `/global/event` path and mapping.

The server must bind to loopback only. The sandbox configuration must allow
the child to bind and accept the extension host's loopback connection without
opening non-loopback inbound access.

### Network modes

Map the visible network setting as follows:

- Network off: retain filesystem restrictions and deny non-loopback outbound
  network access.
- Network on: retain filesystem restrictions but set the runtime network mode
  to unrestricted outbound access. This is the default when effective Chat
  sandboxing is on.

The extension must not use VS Code's optional unsandboxed-command retry for
OpenCode tool failures. OpenCode is not connected to the Copilot approval
workflow, so a denied operation must remain denied unless the user explicitly
changes the sandbox setting and restarts the companion.

### Filesystem rules

The runtime configuration must provide the minimum paths required by the
companion:

- Current workspace read/write access.
- Any additional workspace folders explicitly allowed by Chat workspace policy.
- OpenCode configuration and authentication paths required to start and use
  the companion.
- OpenCode session/state paths required to persist sessions.
- Runtime and cache paths required by enabled MCP servers and provider tools.
- Temporary paths required by the runtime and OpenCode.

Do not grant broad home-directory access. Do not automatically allow
credential stores such as `.ssh`, `.aws`, `.gnupg`, Keychains, or unrelated
application data. Missing paths should produce a visible sandbox error and be
added narrowly after testing.

The Chat workspace policy does not support every profile feature needed by the
runtime. Any default paths added by the extension must be documented, minimal,
and covered by tests.

### Network and MCP compatibility

Local stdio MCP processes inherit the companion sandbox. Their executable,
configuration, cache, and authentication paths must be explicitly permitted.

Remote MCP and web research requests require either unrestricted outbound
network access or an allowlist that includes every required provider and
service domain. A failed network request must surface as a normal OpenCode
tool error and must not trigger an unsandboxed retry.

## Companion Lifecycle

### Startup

The agent must track:

- SDK client.
- Child process handle.
- Sandbox initialization state.
- Server URL and whether the URL belongs to the sandboxed companion.
- SSE abort controller.
- Startup stdout/stderr buffers.

Startup failure must clean up the child and runtime resources before rejecting.
The extension must distinguish missing dependencies, sandbox denials, database
locks, missing OpenCode binaries, and ordinary server failures where practical.

### Disconnect

Disconnect must:

- Abort the SSE stream.
- Stop accepting new Chat requests.
- Terminate the companion child and its descendants reliably.
- Wait for the child to exit before releasing runtime resources.
- Reset `SandboxManager` when no sandboxed companion remains.
- Avoid orphaning proxy or helper processes.

The current synchronous `IAgent.disconnect(): void` contract is insufficient for
reliable async runtime cleanup. Evaluate either adding an async shutdown path
or introducing a separate host-owned `dispose()` operation while preserving
existing callers during migration.

### Runtime setting changes

Changing filesystem policy, switching the effective `inherit | on | off` mode,
or changing Chat network policy requires a companion restart because sandbox
restrictions are fixed when the child starts.

The host-side controller must:

1. Reject or defer changes while a request is actively running, with a clear
   UI state.
2. Persist the Chat workspace setting change only after validation of the
   requested values.
3. Stop the current companion cleanly.
4. Start the companion with the new settings.
5. Preserve event subscriptions across reconnect, or explicitly re-register
   them.
6. Re-send sandbox status and the normal initialization payload.
7. Refresh sessions, active session, providers, agents, MCP status, and file
   changes in the webview.
8. Surface startup failure without silently reverting to an unsandboxed
   process.

The controller must listen for Chat-specific configuration changes made outside
the panel and apply the same lifecycle path. When Chat mode is `inherit`, it
must also listen for changes to the native sandbox-enabled setting and
recompute the effective Chat mode. Changes must be debounced so one user action
does not create multiple companion restarts.

## Host and Protocol Changes

Add a domain type representing effective Chat sandbox state, for example:

```ts
type ChatSandboxStatus = {
  supported: boolean;
  mode: "inherit" | "on" | "off";
  enabled: boolean;
  inherited: boolean;
  allowNetwork: boolean;
  applying: boolean;
  managed: boolean;
  error?: string;
};
```

Extend the protocol with:

- A sandbox status in the initial host-to-webview initialization payload or a
  dedicated `sandboxStatus` message.
- A single atomic UI-to-host `setSandboxSettings` message containing the
  desired mode and network values.

The host handler must update the Chat workspace settings through VS Code's
configuration API, then run the companion restart path. It must return or post
the effective state after the update rather than assuming the update succeeded.

If a managed setting prevents an update, post the unchanged effective state and
an explanatory error. The reset action removes the Chat mode override and
restores `inherit`. Do not store a second policy in `UIPersistedState`.

Refactor the existing `ready` initialization work in `ChatViewProvider` into a
reusable method so it can be called after a sandbox-triggered reconnect.

## Webview Changes

Update the settings data flow:

- `ToolConfigPanel` accepts `sandboxStatus` and an atomic settings callback.
- `InputArea` passes the new props into `ToolConfigPanel`.
- `App.tsx` stores the latest host-reported sandbox status and posts setting
  changes.
- `AppContext` includes the status only if shared access is needed elsewhere;
  avoid adding context solely for the panel.
- Disable sandbox controls while the companion is restarting.
- Preserve the existing MCP, language, sound, and config-link sections.
- Add localized labels, descriptions, status text, and error text in every
  supported locale.
- Use VS Code theme variables and the existing compact toggle styling.

The panel should distinguish:

- Sandbox unavailable on the current platform.
- Sandbox inherited from VS Code and active.
- Sandbox inherited from VS Code and inactive.
- Sandbox explicitly enabled for this workspace.
- Sandbox explicitly disabled for this workspace.
- Sandbox active with network restricted.
- Sandbox active with network unrestricted.
- Workspace mode reset to VS Code inheritance.
- Sandbox restart in progress.
- Sandbox startup failure.

## OpenSpec Scaffold

Use one OpenSpec change for this feature. Do not create a separate change for
CLI/TUI Seatbelt work because that is explicitly out of scope.

Recommended change name:

```text
add-chat-agent-sandbox
```

The repository's default `spec-driven` workflow is:

```text
proposal -> specs -> design -> tasks
```

The scaffold should contain:

### `proposal.md`

Document the security goal, the Chat-only scope, the workspace `inherit | on |
off` settings model, the default Chat network behavior, and the non-goals
covering CLI/TUI, aliases, `OPENCODE_BIN`, sandboxtron, and whole-application
sandboxing.

### `specs/chat-agent-sandbox/spec.md`

Add requirements and scenarios for:

- Resolving workspace `inherit | on | off` mode before companion startup.
- Following the native sandbox-enabled setting only while mode is `inherit`.
- Rendering and updating the sandbox and network controls.
- Enabling Chat for a workspace when native VS Code sandboxing is off.
- Disabling Chat for a workspace when native VS Code sandboxing is on.
- Resetting a workspace override to native inheritance.
- Defaulting Chat network access to true when sandboxing is effective.
- Starting the companion inside the runtime when enabled.
- Preserving normal behavior when disabled.
- Applying filesystem restrictions to OpenCode descendants.
- Applying restricted or unrestricted outbound network policy.
- Preserving Scout/Build permissions and `OPENCODE_CONFIG_CONTENT`.
- Allowing loopback client-to-server connectivity only.
- Restarting and reinitializing the companion after policy changes.
- Preserving sessions and MCP preferences across restart.
- Failing closed on sandbox startup or runtime errors.
- Handling managed/read-only workspace settings.
- Keeping CLI/TUI and independent OpenCode processes unchanged.

### `design.md`

Describe:

- Host settings/controller ownership.
- `OpenCodeAgent` launch options and runtime integration.
- `SandboxManager` initialization and reset lifecycle.
- Safe command construction and child process spawning.
- Loopback binding and network proxy behavior.
- Filesystem path derivation and policy merging.
- Reconnect sequencing and event listener preservation.
- Protocol and webview state flow.
- Error and managed-setting behavior.
- VSIX bundling implications.

### `tasks.md`

Break implementation into independently verifiable tasks:

1. Add and pin the runtime dependency.
2. Add Chat workspace settings, native inheritance resolution, and a host-side
   sandbox controller.
3. Add sandboxed companion launch and lifecycle cleanup.
4. Preserve Scout/Build configuration and SDK event behavior.
5. Add sandbox status and settings protocol messages.
6. Add ToolConfigPanel controls and localized strings.
7. Add reconnect and initialization refresh behavior.
8. Add unit, extension-host, webview, and macOS integration tests.
9. Build and package the VSIX, then verify the runtime is bundled.
10. Update the main OpenSpec specification after verification.

The completed scaffold is located at
`openspec/changes/add-chat-agent-sandbox/`. After review, implementation can
start from its task list. To recreate or inspect the default workflow, use:

```sh
openspec new change "add-chat-agent-sandbox"
openspec status --change "add-chat-agent-sandbox" --json
openspec instructions proposal --change "add-chat-agent-sandbox"
```

The change artifacts should remain reviewed before source implementation begins.

## Implementation Phases

### Phase 1: Settings and runtime controller

- Add the injected sandbox configuration types.
- Read Chat workspace mode and network settings during activation.
- Resolve `inherit` from the effective native sandbox-enabled setting.
- Detect managed/read-only Chat workspace settings.
- Create the host-side controller and status model.
- Define restart and error states.

### Phase 2: Sandboxed companion launch

- Add `@vscode/sandbox-runtime`.
- Implement `SandboxManager.initialize()` and cleanup ownership.
- Replace only the effective `on` Chat launch path with explicit child
  spawning.
- Preserve workspace `cwd`, config overlay, port `0`, readiness, SDK client,
  and SSE setup.
- Remove the global `process.chdir()` dependency from the sandboxed path.

### Phase 3: Settings panel and protocol

- Add status/settings message types.
- Add the sandbox section to `ToolConfigPanel`.
- Add the visible network sub-option.
- Add inherited-state display and reset-to-VS-Code action.
- Add all locale strings and compact styling.
- Reflect effective Chat values, workspace overrides, native inheritance, and
  managed setting state.

### Phase 4: Live setting changes

- Implement atomic Chat workspace setting updates.
- Recompute inherited mode when the native sandbox-enabled setting changes.
- Restart the companion safely after mode changes.
- Preserve event subscriptions and refresh webview initialization data.
- Preserve active sessions and MCP preference reapplication.
- Prevent duplicate restarts and unsafe toggles during active requests.

### Phase 5: Verification and packaging

- Run focused runtime, agent, host, panel, and scenario tests.
- Run macOS sandbox integration tests.
- Run `npm run check`.
- Run `npm run build`.
- Package the VSIX and verify the runtime is bundled.
- Confirm CLI/TUI behavior was not changed by this feature.

## Tests

### Runtime and agent tests

Cover:

- Effective Chat mode off uses the normal companion path.
- Effective Chat mode on wraps the server process.
- Inherit follows native sandbox-enabled state.
- Workspace on/off overrides remain local to the active workspace.
- Chat network defaults to on when the effective sandbox is on.
- Chat network off passes the restricted network policy.
- Chat network on keeps filesystem restrictions and allows outbound access.
- Workspace `cwd` is propagated.
- Scout and Build overlay configuration is preserved.
- `OPENCODE_CONFIG_CONTENT` is inherited by the sandboxed server.
- Loopback binding and SDK client connection succeed.
- Startup stderr and early child exit become connection errors.
- Disconnect terminates the server and runtime helpers.
- Sandbox failure never falls back to an unsandboxed server.

### Host and protocol tests

Cover:

- Chat mode and network settings are read before connect.
- Inherit reacts to native sandbox-enabled changes.
- Workspace settings update without changing native VS Code settings.
- Reset removes the workspace mode override.
- Managed settings are reported as read-only.
- Configuration changes trigger one restart.
- Reconnect re-sends initialization data.
- Active session and MCP preferences survive reconnect.
- Sandbox status is posted to the webview.

### Webview tests

Cover:

- Sandbox section renders configured and effective state.
- Network control is visible and independent when sandboxing is on.
- Network control is disabled when sandboxing is off.
- Inherited state and reset action work correctly.
- Toggle sends the atomic settings message.
- Restarting disables controls and displays status.
- Errors are visible without breaking MCP, language, or sound settings.
- All locale strings render correctly.

### macOS integration tests

Verify with an actual OpenCode companion:

- A workspace file can be read and written when permitted.
- A denied file operation fails inside the sandbox.
- Network-off mode blocks an external request.
- Network-on mode permits provider and research requests.
- Local MCP startup inherits the sandbox.
- Loopback Chat API traffic works.
- The child and helper processes exit on disconnect.
- The extension host itself remains usable outside the sandbox.

## Acceptance Criteria

The feature is complete when:

- A user can control Chat sandboxing from the gear settings panel.
- The panel supports `inherit`, workspace `on`, and workspace `off`.
- The panel's controls reflect configured and effective Chat state.
- Sandbox mode is applied before the companion server starts.
- Chat network access defaults to enabled when sandboxing is effective and is
  independently selectable and clearly described.
- Network-disabled Chat remains useful for local sessions and local tools.
- Network-enabled Chat supports providers, web research, and remote MCPs.
- OpenCode shell and MCP descendants inherit the filesystem policy.
- Existing Scout/Build permissions and MCP behavior are preserved.
- Changing the policy safely restarts and reconnects the companion.
- Sandbox failures are visible and never silently downgraded.
- The effective non-sandboxed path remains behaviorally compatible.
- CLI, TUI, handoff, aliases, and wider Seatbelt plans remain untouched.
- Focused tests, full checks, build, and VSIX verification pass.

## Rollback

- Set the active Chat workspace mode to `off`, or to `inherit` while native
  sandboxing is off, to restore the normal Chat launch path.
- If a setting change cannot be applied, retain the previous effective state
  and show the error.
- Remove the runtime dependency and sandbox launch path only through a normal
  code change; do not require uninstalling or modifying OpenCode CLI files.

## References

- [VS Code agent sandbox settings](https://code.visualstudio.com/docs/agents/run/approvals#_sandbox-agent-commands)
- [VS Code trust and safety](https://code.visualstudio.com/docs/agents/concepts/trust-and-safety)
- [`@vscode/sandbox-runtime`](https://github.com/microsoft/vscode-sandbox-runtime)
- [`OpenCodeAgent`](../packages/agents/opencode/src/opencode-agent.ts)
- [`ChatViewProvider`](../packages/platforms/vscode/src/chat-view-provider.ts)
- [`ToolConfigPanel`](../packages/platforms/vscode/webview/components/organisms/ToolConfigPanel/ToolConfigPanel.tsx)
- [Core protocol](../packages/core/src/protocol.ts)
- [OpenSpec default workflow](../openspec/config.yaml)
