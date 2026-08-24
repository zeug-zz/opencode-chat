
# macOS Seatbelt Sandbox for OpenCode

## Status

Proposed implementation plan.

## Goal

Run OpenCode on macOS inside a Seatbelt sandbox that:

- Allows unrestricted outbound Internet access for providers, remote MCP servers, web tools, and local MCP servers that make network requests.
- Allows OpenCode to read and write `/Users/zeug/Projects`.
- Allows OpenCode to read and write `/Users/zeug/Documents/Agora`.
- Allows OpenCode to read and write `/Users/zeug/Documents/Philosophy/Die Lichtung/The Phenomenal World/Relative State Observer`.
- Allows the runtime state, caches, executables, and temporary files required for OpenCode and MCP servers.
- Makes ordinary `opencode` CLI invocations use the sandbox automatically.
- Integrates with the `opencode-chat` VS Code extension without relying on a shell alias.
- Preserves the extension's existing agent permissions and MCP behavior.

The implementation must distinguish between sandboxing the OpenCode CLI process tree and sandboxing the OpenCode server that powers the VS Code chat panel. These are separate process boundaries in the current codebase.

## Security Model

Seatbelt is a process-scoped boundary. A sandboxed process and its descendants inherit the profile. This covers OpenCode's shell commands, local stdio MCP servers, LSP processes, formatters, and other child processes launched below the sandboxed process.

The sandbox is not a complete confidentiality boundary:

- Full outbound Internet access allows any process inside the sandbox to exfiltrate data it can read.
- Files inside the three allowed workspaces remain readable and writable.
- OpenCode authentication files and inherited environment variables may contain provider credentials.
- A process can continue using file descriptors that were already open when the sandbox was applied.
- Seatbelt profiles do not provide reliable hostname-level network filtering.
- `sandbox-exec` is deprecated by Apple, although the underlying Seatbelt facility remains present and is used by macOS software.

This plan is defense in depth for workspace access. It is not a replacement for least-privilege credentials, OpenCode permissions, a dedicated user account, or a VM/container when stronger isolation is required.

## Current Repository Findings

### Agora

The Agora project contains a project-local OpenCode configuration at:

`/Users/zeug/Documents/Agora/.opencode/opencode.json`

The current configuration defines the optional `playwright` MCP as a local `npx` command and leaves it disabled by default. When enabled, the sandbox must permit the Node/npm runtime, npm's cache, and Playwright's browser cache. Other local MCP installations require their executable directories to be added explicitly.

The repository guidance states that credentials must not be stored in the workspace. The sandbox plan must not add keys, tokens, passwords, or credential values to profile files, wrapper scripts, OpenCode configuration, or this report.

### opencode-chat

The relevant project is:

`/Users/zeug/Projects/opencode-chat`

The VS Code package is `opencode-chat`, published by `zeug-zz`, with the extension identifier `zeug-zz.opencode-chat`.

The current extension has two different OpenCode launch paths.

#### CLI and terminal handoff path

`packages/platforms/vscode/src/vscode-platform-services.ts` contains `resolveOpencodeBinary()`.

The resolver checks these candidates in order:

1. `process.env.OPENCODE_BIN`
2. `/opt/homebrew/bin/opencode`
3. `/usr/local/bin/opencode`
4. `~/.opencode/bin/opencode`
5. `opencode` from `PATH`

The same module uses the resolved binary for terminal handoff operations:

- `openTerminal()` runs `opencode attach`.
- `runHandoffTerminal()` runs `opencode import` with `execFile()` and then opens `opencode --continue` in a terminal.

A shell alias is not sufficient for these calls. `execFile()` does not expand aliases, and the resolver may select an absolute Homebrew path before consulting `PATH`. `OPENCODE_BIN` must therefore point to the wrapper by absolute path.

#### In-process chat server path

`packages/agents/opencode/src/opencode-agent.ts` creates OpenCode directly in the extension host:

```ts
const server = await createOpencodeServer({
  port: 0,
  config: {
    agent: {
      scout: { /* read-only permissions */ },
      build: { /* read and edit permissions */ },
    },
  },
});
```

The extension then creates an SDK client for that in-process server. `disconnect()` closes the server directly.

This server does not invoke the `opencode` executable. It does not use `OPENCODE_BIN`, the shell, or the user's alias. Consequently:

- The CLI wrapper protects terminal TUI sessions and terminal handoff sessions.
- The CLI wrapper does not protect the current VS Code Chat view.
- Sandboxing the entire VS Code application would sandbox all extensions and processes, and is not the preferred design.

The Chat view requires a separate refactor in which the extension spawns a sandboxed OpenCode server process and connects to it over loopback.

## Proposed Architecture

Use three layers:

1. A Seatbelt profile that defines filesystem, process, temporary-file, and network permissions.
2. An absolute wrapper executable that launches the real OpenCode binary through `/usr/bin/sandbox-exec`.
3. An `opencode-chat` backend change that uses the wrapper for the Chat view's OpenCode server instead of creating that server in the extension host.

The wrapper is the security boundary. The alias is only a convenience for interactive shells.

## Phase 1: Create the Seatbelt Profile

Create the configuration directory and profile location:

```sh
mkdir -p /Users/zeug/.config/opencode /Users/zeug/.local/bin
```

Create `/Users/zeug/.config/opencode/opencode.sb` with the following initial profile:

```scheme
(version 1)
(deny default)
(import "system.sb")

(allow process-exec)
(allow process-fork)
(allow pseudo-tty)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)

(allow network-outbound)
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))

(allow file-read-metadata
  (literal "/")
  (literal "/Users")
  (literal "/Users/zeug")
  (literal "/Users/zeug/Projects")
  (literal "/Users/zeug/Documents")
  (literal "/Users/zeug/Documents/Philosophy")
  (literal "/Users/zeug/Documents/Philosophy/Die Lichtung")
  (literal "/Users/zeug/Documents/Philosophy/Die Lichtung/The Phenomenal World")
  (literal "/Users/zeug/.opencode")
  (literal "/Users/zeug/.config")
  (literal "/Users/zeug/.local")
  (literal "/Users/zeug/.npm")
  (literal "/Users/zeug/.cache")
  (literal "/Users/zeug/Library")
)

(allow file-read*
  (literal "/")
  (subpath "/System")
  (subpath "/Library")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/dev")
  (subpath "/etc")
  (subpath "/private/etc")
  (subpath "/private/var/db/timezone")
  (subpath "/private/var/db/dyld")
  (subpath "/private/var/folders")
  (subpath "/private/tmp")
  (subpath "/Applications")
  (subpath "/opt/homebrew")
  (subpath "/usr/local")
  (subpath "/Users/zeug/.opencode")
  (subpath "/Users/zeug/.config/opencode")
  (subpath "/Users/zeug/.local/share/opencode")
  (subpath "/Users/zeug/.npm")
  (subpath "/Users/zeug/.cache")
  (subpath "/Users/zeug/Library/Caches/ms-playwright")
  (subpath "/Users/zeug/Projects")
  (subpath "/Users/zeug/Documents/Agora")
  (subpath "/Users/zeug/Documents/Philosophy/Die Lichtung/The Phenomenal World/Relative State Observer")
)

(allow file-write*
  (subpath "/dev")
  (subpath "/private/var/folders")
  (subpath "/private/tmp")
  (subpath "/Users/zeug/.config/opencode")
  (subpath "/Users/zeug/.local/share/opencode")
  (subpath "/Users/zeug/.npm")
  (subpath "/Users/zeug/.cache")
  (subpath "/Users/zeug/Library/Caches/ms-playwright")
  (subpath "/Users/zeug/Projects")
  (subpath "/Users/zeug/Documents/Agora")
  (subpath "/Users/zeug/Documents/Philosophy/Die Lichtung/The Phenomenal World/Relative State Observer")
)
```

### Profile rationale

- `deny default` makes the profile an allowlist rather than an unrestricted profile with a few exclusions.
- `import "system.sb"` supplies required macOS system behavior.
- `process-exec` and `process-fork` permit OpenCode to run shells, MCP servers, formatters, LSPs, and other tools.
- `pseudo-tty` supports shells and tools that allocate terminal sessions.
- `network-outbound` allows unrestricted outbound Internet access.
- Loopback network rules allow OpenCode's local HTTP server and a future external server used by the VS Code extension.
- `/private/etc` is required for DNS and certificate configuration.
- `/private/var/folders` and `/private/tmp` are required for macOS temporary files. The canonical `/private` paths are included because `/etc`, `/tmp`, and `/var` resolve through macOS filesystem indirections.
- `/opt/homebrew`, `/usr/local`, and `~/.opencode` cover common OpenCode, Node, npm, and MCP installations.
- `~/.config/opencode` and `~/.local/share/opencode` cover OpenCode configuration, session data, and authentication state.
- The three workspace roots are the only user data trees granted read and write access.

The runtime exceptions outside the workspaces are intentional. OpenCode cannot persist sessions, authenticate MCP servers, use npm-based local MCPs, or run Playwright without some state and cache paths.

### Local MCP paths

The initial profile does not grant access to arbitrary local MCP source trees. For each local MCP installed outside the listed paths:

- Add its installation directory to `file-read*` only.
- Add its data/cache directory to `file-write*` only when required.
- Keep MCP working directories inside one of the approved workspaces where possible.

For example, a locally installed MCP under `/Users/zeug/Documents/Cline/MCP` would need a narrowly scoped read-only rule for the specific server directory. Do not automatically allow the entire `Cline/MCP` tree if only one server is needed.

If the profile fails during testing, add the smallest missing runtime path or operation. Do not replace the profile with `(allow default)` because that defeats the workspace boundary.

## Phase 2: Create the CLI Wrapper

Create `/Users/zeug/.local/bin/opencode-sandbox`:

```sh
#!/bin/sh
set -eu

PROFILE="/Users/zeug/.config/opencode/opencode.sb"

for REAL in \
  "/opt/homebrew/bin/opencode" \
  "/usr/local/bin/opencode" \
  "$HOME/.opencode/bin/opencode"
do
  if [ -x "$REAL" ] && [ "$REAL" != "$0" ]; then
    export OPENCODE_DISABLE_AUTOUPDATE=1
    exec /usr/bin/sandbox-exec -f "$PROFILE" "$REAL" "$@"
  fi
done

printf '%s\n' "Could not find the real opencode binary." >&2
exit 127
```

Make it executable:

```sh
chmod 755 /Users/zeug/.local/bin/opencode-sandbox
```

The wrapper deliberately disables OpenCode auto-update. The profile does not grant write access to the installation directories, so OpenCode updates should be performed separately outside the sandbox. Remove that environment assignment only if sandboxed updates are explicitly required and the installation path is granted write access.

If the real binary is installed elsewhere, add its absolute path to the wrapper. Do not resolve the real binary with `command -v opencode` after installing the alias, because that can resolve back to the wrapper.

## Phase 3: Shell and GUI Integration

Add the following to `~/.zshrc`:

```sh
export OPENCODE_BIN="/Users/zeug/.local/bin/opencode-sandbox"
alias opencode="/Users/zeug/.local/bin/opencode-sandbox"
```

The alias makes this work in an interactive shell:

```sh
opencode
opencode run "Explain this project"
opencode mcp list
```

The environment variable is the important setting for `opencode-chat`. Its binary resolver checks `OPENCODE_BIN` before the absolute Homebrew paths.

For a GUI-launched VS Code process, set the environment in the user's launchd session before starting VS Code:

```sh
launchctl setenv OPENCODE_BIN /Users/zeug/.local/bin/opencode-sandbox
```

Use a user LaunchAgent or another login-time mechanism if this environment variable must be restored after every login. Restart VS Code completely after changing it. Reloading only a window is not sufficient because the extension host inherits its environment when VS Code starts.

## Phase 4: CLI Verification

Run a filesystem and network smoke test:

```sh
/usr/bin/sandbox-exec \
  -f /Users/zeug/.config/opencode/opencode.sb \
  /bin/sh -c '
    printf test > /Users/zeug/Documents/Agora/.seatbelt-test &&
    rm /Users/zeug/Documents/Agora/.seatbelt-test &&
    if /usr/bin/touch /Users/zeug/.seatbelt-escape-test 2>/dev/null; then
      rm -f /Users/zeug/.seatbelt-escape-test
      exit 1
    fi &&
    /usr/bin/curl -fsS https://example.com >/dev/null
  '
```

Expected behavior:

- Writing and deleting a file in Agora succeeds.
- Creating a file directly in `/Users/zeug` fails.
- `curl` can reach the public Internet.

Then test the actual wrapper from an approved workspace:

```sh
cd /Users/zeug/Documents/Agora
/Users/zeug/.local/bin/opencode-sandbox --version
/Users/zeug/.local/bin/opencode-sandbox mcp list
```

Test the TUI only after the non-interactive checks succeed:

```sh
cd /Users/zeug/Documents/Agora
/Users/zeug/.local/bin/opencode-sandbox
```

The sandboxed TUI starts its local server inside the same sandboxed process tree. Do not attach to an OpenCode server that was started before the wrapper was installed. The security boundary belongs to the backend server process, not merely to the TUI client.

## Phase 5: Integrate the Current opencode-chat CLI Paths

After setting `OPENCODE_BIN`, verify the extension's terminal operations:

1. Open a workspace under one of the three allowed roots.
2. Activate the `opencode-chat` extension.
3. Use the terminal handoff action.
4. Confirm the terminal starts the wrapper rather than `/opt/homebrew/bin/opencode` directly.
5. Confirm `opencode attach`, `opencode import`, and `opencode --continue` operate from the approved workspace.

The current extension code should use the wrapper for these paths because `resolveOpencodeBinary()` gives `OPENCODE_BIN` priority. Add extension tests that assert:

- `OPENCODE_BIN` is selected before the Homebrew candidates.
- The generated terminal command contains the absolute wrapper path.
- Handoff import uses the wrapper through `execFile()`.
- The terminal working directory remains the selected workspace.

This phase does not yet sandbox the Chat view's in-process server.

## Phase 6: Sandbox the opencode-chat Chat Backend

### Required refactor

Replace the current in-process `createOpencodeServer()` path in `OpenCodeAgent.connect()` with a child OpenCode server launched through the sandbox wrapper.

The target process tree should be:

```text
VS Code extension host
  +-- opencode-sandbox
        +-- opencode serve
              +-- shell tool processes
              +-- local MCP processes
              +-- LSP and formatter processes
```

The extension host itself should remain outside the Seatbelt profile. This keeps other VS Code extensions and Electron services from being accidentally sandboxed and avoids making the entire editor the security boundary.

### Server lifecycle design

Implement the following lifecycle in `OpenCodeAgent`:

1. Resolve the wrapper using `OPENCODE_BIN`, with an explicit absolute fallback only if necessary.
2. Spawn the wrapper directly with `spawn()` or `execFile()`. Do not invoke a shell and do not depend on an alias.
3. Start `opencode serve` with `--hostname 127.0.0.1` and a dedicated free port.
4. Set the child process working directory to the selected workspace.
5. Preserve the current inline agent configuration, including the read-only Scout permissions and the Build agent permissions.
6. Pass runtime configuration through a supported mechanism such as `OPENCODE_CONFIG_CONTENT` or an allowed project configuration file. Never put credentials in that configuration.
7. Poll the local health endpoint until the server is ready.
8. Create the SDK client with the loopback server URL.
9. Subscribe to events as the current implementation does.
10. Store the child process handle alongside the SDK client.
11. On `disconnect()`, abort event streams, dispose the SDK session if required, terminate the child process, and remove process listeners.
12. Surface child startup failures, early exits, and stderr output as extension connection errors.

The OpenCode server documentation defines `opencode serve` as a headless HTTP server and documents its loopback default. The implementation should verify whether the installed CLI accepts port `0`; otherwise, allocate and reserve a dedicated free local port before spawning the child.

### Configuration preservation

The current extension passes an in-memory configuration overlay to `createOpencodeServer()`:

- Scout is read-only and denies editing, shell, and task execution.
- Build denies unspecified permissions and permits reading, searching, web access, and editing.

The external server must receive equivalent configuration. A refactor that merely launches `opencode serve` without carrying this overlay would be a behavioral and security regression.

The child should inherit provider environment variables only as required. Review the existing launchd environment before implementation because provider keys inherited by OpenCode are also inherited by shell and MCP descendants.

### Loopback policy

The Seatbelt profile allows loopback binding and inbound connections only for `localhost:*`. The server must bind to `127.0.0.1`, not `0.0.0.0`, unless there is an explicit requirement for LAN access.

Remote MCP and provider traffic remains outbound and unrestricted. A local MCP that connects to a service on a non-loopback address will require a deliberate policy decision and a narrowly scoped network rule.

### Attach and handoff behavior

The extension's terminal handoff must attach to the sandboxed server URL. It must not silently start a second unsandboxed server.

Add a server-state invariant:

- Every server URL created by the Chat view must correspond to a child process started through the wrapper.
- `attach` is permitted only for a server recorded as sandboxed by the extension.
- Existing arbitrary localhost URLs must not be treated as sandboxed merely because they use loopback.

## Phase 7: Tests

### Seatbelt smoke tests

Verify that:

- The three workspace roots are readable.
- The three workspace roots are writable.
- A file outside the roots cannot be read.
- A file outside the roots cannot be created or modified.
- Outbound HTTPS works.
- Loopback server binding works.
- Non-loopback inbound access is not opened.
- Child processes inherit the same restrictions.

### MCP tests

Test at least one remote MCP and one local stdio MCP:

- Remote MCP requests succeed over outbound Internet access.
- A local MCP executable can start under the sandbox.
- A local MCP can read and write only its approved workspace/data paths.
- `npx` can use its cache when the Playwright MCP is enabled.
- Playwright browser binaries can start if Playwright is enabled.
- MCP authentication state remains outside the workspace and is available only where explicitly permitted.

### opencode-chat unit tests

Add tests for:

- Wrapper path resolution through `OPENCODE_BIN`.
- Server child process arguments.
- Workspace `cwd` propagation.
- `OPENCODE_CONFIG_CONTENT` or equivalent configuration propagation.
- Health polling and SDK client creation.
- Child process cleanup on disconnect.
- Child process cleanup when the extension host is deactivated.
- Child process early-exit errors.
- Rejection of an attach URL that was not created by the sandboxed server manager.

### Integration test

Run the extension against a temporary approved workspace and assert:

1. The Chat view can read files in the workspace.
2. The Chat view can edit files in the workspace when the Build permissions allow it.
3. A shell command cannot read a known file outside the approved roots.
4. A shell command can reach an external HTTPS endpoint.
5. A local MCP can start and respond.
6. The server child and its MCP descendants exit when the extension disconnects.

## Credential and Data Handling

The sandbox must not be treated as a way to protect credentials from OpenCode itself.

Current operational requirements include rotating the previously exposed API keys. After rotation:

- Keep keys out of this repository and all project-local OpenCode files.
- Prefer a credential mechanism that does not expose long-lived raw keys to arbitrary shell commands.
- Review launchd environment variables because the sandboxed OpenCode process inherits them.
- Review `~/.local/share/opencode/auth.json` and MCP authentication state before granting write access.
- Do not grant broad access to `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/Library/Keychains`, or other credential stores unless a specific integration requires it.
- If Git over SSH is required, handle SSH credentials as a separate exception and document the resulting risk.

Full Internet access means a compromised or misbehaving agent can transmit any data available inside the allowed paths or environment. Stronger credential isolation requires a credential broker, short-lived scoped keys, a separate macOS user, or a VM/container.

## Operational Rules

- Start OpenCode from one of the approved workspace roots.
- Treat an OpenCode server started outside the wrapper as unsandboxed.
- Do not use `opencode attach` to an unknown server and assume it is protected.
- Keep the Playwright MCP disabled unless it is needed, consistent with the current Agora configuration.
- Run OpenCode upgrades outside the sandbox.
- Re-test the profile after macOS, OpenCode, Node, npm, or Playwright upgrades.
- Add missing permissions narrowly rather than broadening the profile to `allow default`.
- Restart OpenCode and VS Code after changing environment variables, extension code, or OpenCode configuration.

## Acceptance Criteria

The implementation is complete when:

- `opencode` in an interactive shell invokes the Seatbelt wrapper.
- `OPENCODE_BIN` causes `opencode-chat` terminal handoff calls to use the wrapper.
- The CLI can operate in all three approved workspaces.
- The CLI can use outbound Internet access and configured MCP servers.
- Reads and writes outside the approved workspace roots fail at the kernel policy layer.
- Runtime state and required caches work without granting broad home-directory access.
- The current `opencode-chat` Chat view uses a sandboxed child OpenCode server rather than `createOpencodeServer()` in the extension host.
- The existing Scout and Build permission behavior is preserved.
- The extension cleans up the sandboxed server process reliably.
- Tests cover filesystem denial, network access, MCP startup, lifecycle cleanup, and CLI path resolution.

## Rollback

The CLI integration can be disabled without deleting the real OpenCode binary:

1. Remove or comment out the `opencode` alias.
2. Unset `OPENCODE_BIN` in the shell and launchd environment.
3. Restart VS Code and OpenCode.
4. Run the real binary directly from its installed path.

The profile and wrapper should remain available for diagnosis until the implementation is verified or explicitly removed.

## References

- [macOS `sandbox-exec(1)` manual](https://manp.gs/mac/1/sandbox-exec)
- [macOS `sandbox(7)` manual](https://manp.gs/mac/7/sandbox)
- [OpenCode CLI documentation](https://opencode.ai/docs/cli/)
- [OpenCode MCP server documentation](https://opencode.ai/docs/mcp-servers/)
- [OpenCode server documentation](https://opencode.ai/docs/server/)
- [OpenCode configuration documentation](https://opencode.ai/docs/config/)
- [OpenCode IDE documentation](https://opencode.ai/docs/ide/)
- [`opencode-chat` VS Code platform services](../../../Projects/opencode-chat/packages/platforms/vscode/src/vscode-platform-services.ts)
- [`opencode-chat` OpenCode agent](../../../Projects/opencode-chat/packages/agents/opencode/src/opencode-agent.ts)
- [Agora OpenCode configuration](../.opencode/opencode.json)
