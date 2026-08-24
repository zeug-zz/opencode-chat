## Context

See `proposal.md` for motivation and `specs/chat-agent-sandbox/spec.md` for
the behavioral contract.

The extension currently creates one `OpenCodeAgent` during activation and calls
the OpenCode SDK's `createOpencodeServer()` helper. That helper starts the
companion child, but it does not provide a command wrapper or sandbox policy
hook. The current `OpenCodeAgent.disconnect()` also clears event listeners,
which is sufficient for final shutdown but not for a settings-driven
companion restart.

The webview settings panel is already routed through typed core protocol
messages. The extension host starts the agent before the webview sends its
`ready` message, so sandbox policy must be owned and loaded by the host before
the first companion connection.

## Goals / Non-Goals

**Goals:**

- Add a Chat-only sandbox mode that inherits the native VS Code sandbox state
  by default while allowing workspace-local overrides.
- Keep Chat sandbox settings independent from VS Code-wide Copilot settings.
- Apply filesystem and process restrictions to the companion server's entire
  descendant tree.
- Offer explicit unrestricted outbound network access for research and remote
  MCP use without removing filesystem restrictions.
- Reconnect the companion safely when Chat sandbox settings change.
- Preserve Scout/Build configuration, SDK event behavior, sessions, MCP state,
  and existing webview initialization.
- Keep sandbox failures fail-closed when the effective Chat mode is sandboxed.

**Non-Goals:**

- Modifying `chat.agent.sandbox.*` or any other VS Code-wide Copilot setting.
- Sandboxing the extension host, webview, terminal handoff, independent TUI,
  or ordinary OpenCode CLI processes.
- Adding a shell alias, `OPENCODE_BIN` integration, sandboxtron integration, or
  custom Seatbelt profile files.
- Changing OpenCode's Scout/Build permission overlay or MCP configuration
  ownership.

## Decisions

### 1. Use extension-owned workspace mode with native inheritance

Contribute the following settings from the VS Code extension:

- `opencode-chat.chatSandbox.mode`, enum `inherit | on | off`, default
  `inherit`, scoped to the active workspace.
- `opencode-chat.chatSandbox.allowNetwork`, boolean, default `true`, scoped to
  the active workspace.

The effective Chat sandbox state is resolved as follows:

- `inherit` follows the effective VS Code `chat.agent.sandbox.enabled` value.
- `on` enables Chat sandboxing even when the native VS Code setting is off.
- `off` disables Chat sandboxing even when the native VS Code setting is on.
- `allowNetwork` defaults to `true` when Chat sandboxing is effective and is
  independent of `chat.agent.sandbox.allowNetwork`.

The settings panel edits the extension-owned settings through the extension
host. The host reads them during activation and on configuration changes. The
panel does not use `UIPersistedState` as the process-policy source and does not
update `chat.agent.sandbox.*`.

This preserves native inheritance without coupling Chat's network choice to
Copilot. A workspace override is necessary because a boolean cannot distinguish
"follow VS Code" from an explicit local disable. The panel must provide a
reset action that removes the mode override and returns to `inherit`.

The host should update the active workspace configuration target when a panel
control changes. The panel must display the effective value after the update so
workspace overrides, user settings, and managed settings are visible as
read-only behavior where applicable.

### 2. Reuse Microsoft's sandbox runtime programmatically

Add a pinned compatible `@vscode/sandbox-runtime` dependency to the OpenCode
agent package and bundle it with the extension. Use its programmatic API only
for the Chat companion process.

This is preferred over sandboxtron or a custom profile because it avoids a
separate executable installation and gives the extension direct ownership of
configuration, child lifecycle, and failure reporting. The runtime is still
an external preview-oriented dependency, so the exact version must be locked
and verified in the VSIX build.

### 3. Keep two companion launch paths

Keep the existing SDK startup path when the effective Chat sandbox state is
off. This minimizes the behavior change for existing users and avoids requiring
the sandbox runtime in normal operation.

When the effective Chat sandbox mode is `on`, use an explicit child launcher
instead of `createOpencodeServer()`:

1. Build the `opencode serve` command with loopback hostname and port `0`.
2. Wrap the command using `SandboxManager`.
3. Spawn the returned command with the selected workspace as `cwd`.
4. Merge the existing `OPENCODE_CONFIG_CONTENT` Scout/Build overlay into the
   runtime-provided environment.
5. Parse the OpenCode listening announcement and construct the normal SDK
   client with the discovered URL.

The public `IAgent` operations remain unchanged. The launcher is an internal
implementation detail of the agent's connection lifecycle.

### 4. Inject launch settings instead of importing VS Code into the agent

Define a small launch configuration type shared between the extension host and
the agent package. It should contain the workspace path, resolved effective
sandbox mode, network mode, filesystem policy, and executable selection needed
by the companion. The configured `inherit | on | off` mode should be resolved
in the host before it reaches the agent.

The extension host reads VS Code settings and passes normalized values into the
agent. `OpenCodeAgent` must not import `vscode` or directly read workspace
configuration. This preserves the agent package's platform boundary and keeps
the behavior testable without a VS Code runtime.

### 5. Build a narrow runtime policy

The sandbox runtime configuration should allow:

- The active workspace and any explicitly configured additional workspace
  folders permitted by Chat policy.
- OpenCode configuration and session/state paths required by the companion.
- Required runtime caches, temporary paths, and explicitly enabled MCP paths.
- Loopback binding and the extension host's loopback connection.

It must not grant broad home-directory access or automatically allow credential
stores such as `.ssh`, `.aws`, `.gnupg`, Keychains, or unrelated application
data.

With `allowNetwork: false`, deny non-loopback outbound network access. With
`allowNetwork: true`, retain filesystem restrictions and permit outbound
network access. Inbound non-loopback access remains denied in both modes.

The initial implementation should use a deterministic policy derived from the
active workspace and known OpenCode paths. Missing MCP-specific paths should
produce a visible error and a narrowly documented follow-up permission rather
than trigger broad policy expansion.

### 6. Make sandbox setting changes restart the companion

Filesystem restrictions are fixed when the child process starts. Treat changes
to the effective `inherit | on | off` mode or either Chat network setting as a
serialized companion transition:

1. Mark the Chat status as applying and reject or defer new requests.
2. Abort active event streams and stop the current companion.
3. Resolve the configured mode against the native VS Code sandbox state and
   start the new normal or sandboxed companion accordingly.
4. Reconnect the SDK client and event stream.
5. Refresh initialization data, sessions, providers, agents, MCP status, and
   active messages in the webview.
6. Publish the resulting status or a visible failure.

The agent must preserve event subscribers during reconnect and clear them only
on final disposal. The extension may introduce a host-owned controller to
serialize configuration changes and coordinate agent reconnects.

If sandboxed startup fails, the old process must not remain available as an
unsandboxed fallback. The user can explicitly select the Chat workspace mode
`off` to request the normal path again.

### 7. Keep protocol state separate from policy storage

Add a status object to the host/webview protocol containing at least:

- supported state
- configured mode (`inherit`, `on`, or `off`)
- effective enabled state
- inherited-state indicator
- allow-network state
- applying/restarting state
- managed/read-only state
- optional user-facing error

Add one atomic UI-to-host settings message containing the desired mode and
network values. The host persists the extension-owned workspace configuration
and posts the effective result. The webview may keep transient display state,
but it must not become the authority for process startup.

Refactor the provider's initial webview synchronization into a reusable method
so it can be called after a companion restart without requiring a webview
remount.

### 8. Preserve agent and MCP behavior

The sandboxed launch path must pass the same in-memory Scout and Build
configuration overlay currently supplied to `createOpencodeServer()`. It must
continue to use the existing SDK client, event mapping, MCP APIs, and session
database.

MCP connection preferences remain webview preferences. After a successful
companion restart, the existing MCP reapply behavior runs against the new
server status and does not write project or global `opencode.json` files.

## Risks / Trade-offs

- [Runtime API and packaging instability] `@vscode/sandbox-runtime` is a
  preview-oriented dependency and may use platform-specific files or dynamic
  loading. Pin the version, bundle the extension, package a VSIX, and run a
  macOS smoke test before treating the capability as complete.

- [OpenCode state paths are outside the workspace] The companion may fail if
  its config, auth, state, or cache paths are not permitted. Derive and test
  the minimum paths, surface missing-path errors, and never respond by
  allowing the whole home directory.

- [Research needs network access] Local-only mode intentionally prevents
  provider and research calls. Keep the network control visible, describe the
  consequence in the panel, and test both modes.

- [Restart disrupts in-flight work] Disable or defer settings while a request
  is active, abort streams deterministically, and reload persisted session data
  after reconnect.

- [Synchronous lifecycle contract] The current `IAgent.disconnect(): void`
  shape does not express async child and runtime cleanup. Add an internal async
  shutdown path or a host-owned disposal operation without weakening final
  cleanup.

- [Sandboxed network proxy compatibility] OpenCode, providers, and MCP clients
  must honor the runtime's network behavior. Verify real provider and MCP
  traffic on macOS; do not infer compatibility from a unit mock.

- [Fail-closed startup] A sandbox launch failure makes Chat unavailable rather
  than silently reverting to the normal path. Preserve a clear error and let
  the user explicitly select the workspace mode `off` to recover.

- [Native inheritance changes] A workspace using `inherit` must react if the
  effective native VS Code sandbox-enabled setting changes. Listen for native
  configuration changes only to recompute inherited Chat mode; never write
  native settings from the Chat panel.

## Migration Plan

1. Add the extension-owned workspace settings with mode `inherit` and network
   access `true` defaults.
2. Ship the runtime and sandboxed Chat path behind effective mode resolution.
3. Verify that workspaces inheriting a native-off setting continue through the
   SDK path unchanged.
4. Enable `Sandbox Chat tools` in a workspace and verify restart, filesystem
   restrictions, and the default network-enabled Chat behavior.
5. Package and install the VSIX, then run the macOS integration checks.

Rollback is configuration-first: set the active workspace mode to `off` or
`inherit` while the native setting is off to return Chat to its existing path.
A code rollback can remove the runtime dependency and sandbox launcher without
touching OpenCode CLI files, TUI state, or user configuration.

## Open Questions

None that change the specified behavior or the selected architecture. The
exact minimum OpenCode and MCP filesystem paths are implementation details to
be established by focused macOS integration tests and documented with the
 resulting runtime policy.

## Corrective Remediation Scope

Live verification found that local MCP startup can fail under the macOS
sandbox, so the completed implementation requires a platform-adapter and
diagnostics pass before the capability is treated as release-ready. The
policy remains workspace/MCP independent: the active workspace and normalized
runtime paths determine the policy, while local stdio MCP children inherit it
and remote MCPs follow the selected network policy.

The corrective platform matrix is:

| Platform | Capability behavior | Platform-specific policy detail |
| --- | --- | --- |
| macOS | Detect and use the supported runtime backend | Add only the narrow Mach permissions required for DNS and TLS/provider traffic; retain filesystem restrictions and avoid wildcard allowances. |
| Linux | Detect and use the runtime's Linux backend | Do not depend on macOS Mach permissions; verify filesystem, loopback, and network behavior through the Linux adapter. |
| Windows | Report unsupported when no supported backend is available | Keep Chat available through the existing unsandboxed launch path, with status showing sandbox inactive; do not promise or emulate a Windows sandbox backend. |

The remediation also requires diagnostics that preserve sandbox-denial details,
MCP child identity, exit/readiness context, and safe stdout/stderr capture.
Missing local MCP or runtime paths must remain visible failures; they must not
be repaired by allowing the whole home directory or a broad projects tree.
Focused unit/integration tests and live macOS checks must establish the narrow
permissions and portable path policy before the delta is synchronized to the
main specification.
