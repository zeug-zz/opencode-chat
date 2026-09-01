# Optional nono Backend for Chat

## Status

This is a follow-on implementation plan. It must not be started until
`openspec/changes/add-chat-sandbox-read-baseline/` is complete, verified, and
archived (or explicitly superseded).

The intended deployment is:

- A machine with nono installed, such as the developer machine, automatically
  uses nono for the Chat companion.
- A machine without nono, such as the Agora-only user machine, continues using
  the existing `@vscode/sandbox-runtime` Chat sandbox.
- The existing static `denyRead` baseline remains the protection used by the
  fallback backend.

## Context

The extension already has two separate companion launch paths:

- `packages/platforms/vscode/src/extension.ts` resolves the OpenCode
  executable and builds an injected `OpenCodeLaunchConfiguration`.
- `packages/agents/opencode/src/opencode-agent.ts` uses the SDK-managed server
  when sandboxing is off.
- The same agent uses an explicit child process, `SandboxManager`, loopback
  readiness detection, and process-group cleanup when sandboxing is on.
- `packages/agents/opencode/src/launch-config.ts` is the existing boundary for
  passing host-resolved launch choices into the agent.

This makes nono an alternate sandbox backend rather than an installation or
UI rewrite. It must be selected before sandbox initialization. Nono must not be
nested inside `SandboxManager`, because the two systems would own overlapping
policy and process boundaries.

## Goals

- Detect an optional externally installed nono executable from the extension
  host.
- Prefer nono when it is available and passes a non-mutating preflight check.
- Preserve the current `SandboxManager` backend when nono is absent or not
  usable.
- Preserve the existing OpenCode executable, workspace `cwd`, Scout/Build
  overlay, environment, loopback server, SDK client, SSE, MCP, reconnect, and
  teardown behavior.
- Keep the companion sandboxed on both paths.
- Keep the independent OpenCode TUI and terminal handoff behavior unchanged.
- Keep Windows behavior unchanged unless a separate capability decision is
  made; do not claim nono support on Windows merely because nono supports WSL2.

## Non-Goals

- Installing or bundling nono in the VSIX.
- Automatically selecting arbitrary user profiles such as `opencode-local`.
- Reading and trusting user-modified nono profiles as if they were the Chat
  security contract.
- Retrying a failed nono launch through the VS Code sandbox.
- Falling back to an unsandboxed companion.
- Changing the active read-deny baseline or weakening the Agora fallback
  machine's protections.
- Changing the independent CLI/TUI process tree.

## Nono CLI Contract

The current nono CLI does not use `nono opencode serve` as its general command
form. The embedded form is:

```sh
nono wrap --profile opencode --allow-cwd -- opencode serve \
  --hostname 127.0.0.1 --port 0
```

The exact flags and profile behavior must be verified against the supported
nono version during implementation. `nono wrap` is preferred because it
applies the sandbox and execs the child, removing the nono process from the
runtime process tree. `nono run` introduces a supervisor/session lifecycle and
should not be used for the first embedded implementation.

Do not represent `nono opencode` as one executable path or construct the
command through an untrusted shell string. The nono branch should use direct
argv spawning with `shell: false` where the CLI permits it.

## Design

### 1. Complete the current sandbox baseline first

Before adding nono:

- Finish the remaining integration, documentation, build, and strict OpenSpec
  validation tasks for `add-chat-sandbox-read-baseline`.
- Verify that the protected paths are denied by the current runtime and that
  workspace, OpenCode state, runtime caches, temporary paths, and local MCP
  startup still work.
- Preserve the current unsupported Windows behavior.
- Archive the change only after its verification gates pass.

The nono work must build on that result rather than combine two unverified
sandbox changes.

### 2. Add deterministic backend selection

Add an optional backend selection to the host-to-agent launch configuration.
The agent should receive a resolved choice, not inspect VS Code settings or
search the user's environment itself.

Recommended selection semantics:

- `auto`: use nono when its binary and required profile are available;
  otherwise use `SandboxManager`.
- `nono`: require nono and report a visible error if it is unavailable or
  unusable; do not silently switch to another backend.
- `vscode`: force the existing `SandboxManager` backend.

`auto` should be the default if a user-facing setting is added. A setting is
recommended so the developer can force the fallback backend without changing
the machine environment, while the Agora-only machine remains unaffected.
The setting does not need a new webview control initially; a VS Code setting
and status/diagnostic detail are sufficient.

### 3. Resolve and preflight nono in the extension host

Add a resolver near `resolveOpencodeBinary()` in
`packages/platforms/vscode/src/vscode-platform-services.ts` or a small
dedicated resolver module.

The resolver should:

- Prefer an explicit `NONO_BIN` value.
- Check platform-appropriate fixed paths such as Homebrew locations.
- Search the extension host `PATH`.
- Return an optional absolute path rather than a fake fallback string.
- Avoid shell aliases and interactive shell startup files.
- Account for GUI-launched VS Code having a different `PATH` from a terminal.

After locating the executable, perform a bounded `execFile()` preflight using
non-interactive commands such as version and required-profile inspection. Use
one known, documented profile for the initial implementation. Do not discover
or select arbitrary user profiles. Cache the result for the activation or
launch configuration so backend selection does not change halfway through a
reconnect.

If nono is missing, its profile is unavailable, or the preflight is not
supported by the installed version, `auto` selects `SandboxManager`. This is a
preflight availability fallback, not a runtime failure fallback.

### 4. Keep the two sandbox backends as siblings

Refactor the sandboxed portion of `OpenCodeAgent` only enough to make the
backend-specific steps explicit:

- The `SandboxManager` branch retains its existing runtime initialization,
  `SandboxRuntimeConfig`, command wrapping, diagnostics, and reset behavior.
- The nono branch constructs a direct argv launch using the resolved nono
  path, the selected profile, required capability flags, `--`, the resolved
  OpenCode executable, its arguments, and the existing `serve` arguments.
- Both branches use the same workspace `cwd`, child environment,
  `OPENCODE_CONFIG_CONTENT`, stdout/stderr capture, loopback readiness parser,
  SDK client creation, and event subscription.
- The agent records the selected backend for diagnostics and lifecycle cleanup.

The normal unsandboxed SDK path remains unchanged.

### 5. Define the nono policy mapping before implementation

The current Chat policy is dynamic and includes:

- Workspace and OpenCode state/cache/temp write paths.
- Runtime cache and executable read paths.
- The static platform-aware `denyRead` baseline.
- Loopback binding.
- Network-on and network-off behavior.

Nono profiles and command flags do not map one-to-one to this policy. Before
choosing the final launch arguments, verify all of the following with a real
nono smoke test:

- The active workspace is readable and writable where Chat requires it.
- OpenCode state, lock, cache, and temporary paths work.
- The OpenCode executable and required runtime dependencies are readable.
- Local MCP processes inherit the same restrictions.
- Network-on supports the configured provider and MCP traffic.
- Network-off blocks non-loopback traffic while preserving the companion's
  loopback connection.
- Protected credential, browser, shell-history, and keychain paths are not
  accidentally re-enabled by the selected profile.

If the fixed profile cannot express the required policy, use a generated
capability manifest or explicit capability arguments rather than silently
accepting weaker behavior. The manifest schema and temporary-file lifecycle
must be verified against the supported nono version. Do not use a broad,
machine-specific profile as the default implementation.

The nono backend may have a different policy implementation, but it must not
be described as equivalent to the hardened VS Code backend until the above
behavior is tested. The fallback backend must retain the active
`denyRead` contract regardless of nono availability.

### 6. Resolve loopback port behavior

The current launcher asks OpenCode to bind port `0` and parses the selected
port from its output. Nono exposes explicit listen/open-port capability flags,
so verify whether its profile allows a port selected by OpenCode at runtime.

Preferred order:

1. Preserve `--port 0` if the nono profile safely permits dynamic loopback
   binding.
2. If nono requires an explicit port, add a narrowly scoped free-port
   allocation path and grant only that port to nono. Cover collision and
   cleanup behavior.
3. Do not use a fixed well-known port without collision handling.

The readiness parser must continue to accept child output on either stdout or
stderr, but nono diagnostic output must not cause an unrelated URL to be
selected.

### 7. Preserve lifecycle and diagnostics

Update lifecycle state so that:

- `SandboxManager.initialize()` and `SandboxManager.reset()` occur only for
  the VS Code backend.
- Nono startup does not leave stale runtime state from a prior VS Code-backed
  connection.
- Existing detached process-group termination is reused for `nono wrap` and
  is verified against the actual process tree.
- A nono child failure includes backend, readiness, exit, stdout, and stderr
  context without exposing environment secrets or the MCP overlay.
- VS Code runtime-specific violation-store APIs are not called for nono unless
  they are actually active.
- `stopForReconnect()` still waits for complete cleanup before replacement.

If nono starts successfully but exits, times out, cannot bind, or violates its
policy, Chat must report the failure and remain unavailable. It must not start a
second VS Code sandbox automatically. The user can select `vscode` explicitly
or fix nono and reconnect.

### 8. Keep packaging external

Nono should remain an external executable, like OpenCode itself:

- Do not add a platform-specific nono binary to the extension bundle.
- Do not add nono as an npm dependency.
- Document optional installation separately for macOS/Linux users.
- Support `NONO_BIN` for GUI environments where PATH inheritance is incomplete.
- Build and package the VSIX to confirm the new resolver and launch code are
  bundled without changing the dependency packaging model.

## Testing Plan

### Resolver and extension tests

- Explicit `NONO_BIN` takes precedence over fixed paths and PATH.
- Fixed Homebrew and PATH candidates work on supported POSIX platforms.
- Missing, non-executable, and failed-preflight nono values return the
  expected `auto` fallback.
- Explicit `nono` mode reports unavailable rather than silently selecting
  `SandboxManager`.
- Explicit `vscode` mode never probes or launches nono.
- Reconnects reuse the resolved backend consistently.
- Windows remains unsupported for the current Chat sandbox contract.

### Agent unit tests

- Nono argv uses `wrap`, the approved profile/capabilities, `--`, the selected
  OpenCode executable, and the existing serve arguments.
- Paths and arguments containing spaces or quotes remain separate argv values.
- Nono receives the workspace `cwd` and the same overlay environment.
- The nono branch does not initialize or reset `SandboxManager`.
- The VS Code fallback branch remains unchanged when nono is absent.
- Readiness, SDK client creation, and SSE subscription work for both branches.
- Nono startup failure does not launch the VS Code backend.
- Nono child cleanup terminates the companion and local MCP descendants before
  reconnect.
- Diagnostics remain bounded and redacted for both backends.

### Opt-in nono integration tests

Add a separately gated integration suite, for example
`OPENCODE_CHAT_RUN_NONO_INTEGRATION=1`, that runs only when nono and the
required profile are installed. Cover:

- Workspace read/write behavior.
- Protected-path denial.
- OpenCode state/cache/temp behavior.
- Loopback server binding and client connectivity.
- Network-on and network-off behavior.
- A nested local-MCP-like child inheriting the sandbox.
- Complete process-tree cleanup.
- Failure behavior when a required capability is removed.

The normal test suite must remain safe to run without nono installed.

### Release verification

- Run focused resolver, agent, extension, and sandbox tests.
- Run the full test suite and `npm run check`.
- Run `npm run build` and package the VSIX.
- Run strict OpenSpec validation for the new change.
- Perform one live smoke test with nono installed and one clean-environment
  smoke test without nono.
- Verify that independent terminal handoff and TUI processes are unchanged.

## Documentation and OpenSpec

Create a separate OpenSpec change after the deny-read baseline is complete.
Its specification should define:

- Automatic nono selection in `auto` mode.
- Existing VS Code sandbox fallback when nono is unavailable before launch.
- Explicit `nono` and `vscode` override behavior if the setting is added.
- Fail-closed behavior after a selected backend starts or begins readiness.
- Backend-specific policy and support boundaries.
- Unchanged independent TUI and Windows behavior.

Update `README.md`, `packages/platforms/vscode/README.md`, and `SECURITY.md`
to explain that:

- Nono is optional and externally installed.
- The extension does not install or bundle it.
- Auto-selection depends on the extension host environment, especially PATH.
- A missing nono installation uses the current hardened VS Code sandbox.
- Backend selection is not a license to claim identical policy semantics without
  the corresponding integration verification.

If the common launcher proposed in `plans/server-hardening.md` is implemented
first, add nono as a backend of that launcher rather than creating a second
process lifecycle abstraction.

## Risks and Mitigations

- **Profile drift:** Pin and preflight a known profile; do not select arbitrary
  user profiles; record nono version in diagnostics.
- **Policy mismatch:** Require live filesystem/network/MCP verification before
  enabling auto-selection in a release.
- **Keychain exceptions:** Inspect the selected profile for bypasses and do not
  describe it as stronger than the current deny-read baseline without evidence.
- **Port capability mismatch:** Verify dynamic loopback binding or allocate a
  scoped port explicitly.
- **Process leakage:** Use `nono wrap`, direct argv where possible, and test
  process-group cleanup and reconnect serialization.
- **GUI PATH differences:** Support `NONO_BIN`, fixed installation paths, and a
  visible backend diagnostic.
- **Silent security downgrade:** Only fall back when nono is unavailable before
  launch. Never retry a failed nono launch through another backend.
- **Unexpected behavior on the Agora-only machine:** Keep auto mode passive
  when nono is absent and retain the already verified VS Code sandbox.

## Acceptance Criteria

- The deny-read baseline change is complete and verified before this change is
  implemented.
- With no nono installed, Chat behaves as it does today through the hardened
  VS Code sandbox.
- With a supported nono installation, `auto` selects nono without requiring a
  repository or VSIX change.
- The launched command uses the supported nono embedding form and preserves
  the OpenCode Chat overlay and workspace.
- Non-nono fallback and nono launch failures are distinguishable and visible.
- No automatic backend retry occurs after a selected backend fails.
- Companion teardown is complete and reconnects do not accumulate processes or
  race the project database.
- Independent OpenCode TUI processes remain unaffected.
- Windows does not claim a newly supported Chat sandbox without separate
  implementation and specification work.
- Tests, checks, build, packaging, live smoke verification, and strict OpenSpec
  validation pass.
