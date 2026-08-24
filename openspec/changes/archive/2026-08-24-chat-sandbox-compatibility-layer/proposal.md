## Why

The initial Chat sandbox policy is optimized for strict filesystem
confidentiality, but it makes ordinary local MCPs unreliable because their
executables, runtimes, caches, and configuration paths cannot be known from a
small static allowlist. A compatibility-first policy should give users who
would otherwise run the OpenCode CLI without isolation a useful process,
write, and network boundary without requiring MCP-specific security knowledge.

## What Changes

- Replace the strict deny-read filesystem policy used by the enabled Chat
  sandbox with a compatibility policy that permits local MCPs and their
  installed runtimes to read required files without MCP-specific path grants.
- Keep write access constrained to the active workspace and the OpenCode,
  runtime-cache, and temporary paths required by the companion.
- Treat Chat network access as one policy for the entire sandboxed companion
  process tree, including providers, remote MCPs, local MCPs, shell tools, and
  descendants.
- Make sandbox companion teardown tree-complete: stopping or reconnecting MUST
  terminate the wrapper/sandbox shell, `opencode serve`, and all MCP
  descendants before a replacement companion starts, without accumulating npm
  or node MCP processes or racing the project database.
- Keep network-disabled mode local-only and fail remote provider or MCP
  requests inside the sandbox rather than retrying outside it.
- Preserve the existing `inherit`, `on`, and `off` Chat sandbox controls,
  companion lifecycle, Scout/Build overlay, MCP configuration ownership, and
  session behavior.
- Keep local MCP commands defined by the user's OpenCode configuration; do not
  add server-name-specific exceptions or require users to maintain an MCP path
  allowlist.
- Add explicit runtime-state/cache coverage for supported local launchers,
  including POSIX UV data/state/cache directories (`~/.local/share/uv` and
  `~/.cache/uv`) and macOS UV application-support/cache directories
  (`~/Library/Application Support/uv` and `~/Library/Caches/uv`). These are
  derived directory grants only; the policy MUST NOT grant the home root, and
  independent TUI isolation remains unchanged.
- Add narrow compatibility runtime-state coverage for the OpenCode lock/state
  directory derived from `XDG_STATE_HOME/opencode` or
  `~/.local/state/opencode`, and for context-mode session databases derived from
  `XDG_CONFIG_HOME/opencode/context-mode/sessions` or
  `~/.config/opencode/context-mode/sessions`. These grants MUST remain limited
  to the exact derived directories and MUST NOT grant the home root or the
  whole OpenCode configuration directory.
- Add compatibility coverage for runtime-created temporary children: derive
  the per-user macOS temporary root from the configured temporary path and
  grant only the required child creation beneath it, including `.ctx-mode-*`
  directories used by context-mode and runtime temp scripts. Other
  platforms MUST use equivalent platform-safe derivation. The policy MUST
  never broaden this to `/tmp`, the home root, or credential stores.
- Do not broaden agent-level tool permissions or expose alternate code/shell
  execution to Scout or the Markdown-only Chat report writer. Context-mode
  plugin/tool profiles and Bun bootstrap are deferred to a follow-up OpenSpec
  change; the explicit user-controlled `open in tui` handoff remains the coding
  boundary.
- Treat `opencode-notifier-state.json` denial as nonfatal diagnostic noise; it
  remains outside this focused grant unless later evidence shows that it blocks
  Chat or MCP operation.
- Improve compatibility-mode diagnostics so a local MCP startup failure still
  identifies the affected child and captured sandbox/runtime output.
- Keep bounded MCP diagnostics visible and selectable in the Gear panel, with
  long paths, URLs, and error text wrapping instead of being clipped.
- Document the compatibility policy and its security boundary in the root and
  VS Code extension README files.
- Defer strict read isolation, per-MCP grants, and advanced credential-path
  controls to a separate future change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-agent-sandbox`: Change the enabled Chat sandbox from a strict
  read-allowlist model to a compatibility-first filesystem and process policy,
  while retaining global network control and sandbox inheritance for all MCP
  descendants.

## Impact

- `packages/platforms/vscode/src/chat-sandbox-policy.ts`: build the
  compatibility filesystem policy without home-directory deny-read rules.
- `packages/agents/opencode/src/opencode-agent.ts`: preserve the single
  process-tree sandbox and network mapping while retaining MCP diagnostics.
- Sandbox and MCP unit/integration tests: replace strict outside-read
  expectations with compatibility read, constrained-write, process-tree, and
  network scenarios.
- `openspec/specs/chat-agent-sandbox/spec.md`: receive the synchronized
  compatibility requirements after implementation and verification.
- `README.md` and `packages/platforms/vscode/README.md`: explain activation,
  MCP behavior, write confinement, network behavior, and the weaker security
  boundary.

This change does not modify independent OpenCode CLI/TUI behavior, global or
project MCP configuration ownership, VS Code-wide agent sandbox settings, or
the strict advanced-sandbox design that may be added later.

### Scope and Non-goals

- The compatibility layer is limited to the OpenCode companion owned by the
  Chat view.
- It does not grant arbitrary write access to the home directory or unrelated
  user data.
- It does not promise confidentiality from a local MCP that can read user
  files while network access is enabled.
- It does not add per-MCP settings, command-specific filesystem exceptions,
  automatic credential-store access, or an unsandboxed MCP fallback.
- It does not replace the existing strict policy with an implicit promise of
  strong filesystem confidentiality; that is deferred to a future advanced
  mode.
- It does not change independent OpenCode CLI/TUI lifecycle or process
  ownership; TUI remains independent of Chat companion teardown.

## Companion Lifecycle Amendment

Stopping, disconnecting, or restarting a sandboxed Chat companion MUST terminate
its complete POSIX process group/tree, including the wrapper/sandbox shell,
`opencode serve`, and all MCP descendants. The extension MUST await bounded
teardown before starting a replacement. Repeated sandbox or network transitions
MUST NOT accumulate npm/node MCP children, leave orphan companion trees, or race
the project database. Existing sandbox filesystem/network policy and TUI
isolation remain unchanged.

## Verification Commitments

Verification MUST include process-group teardown, escalation, cleanup waiting,
and serialized reconnect coverage in addition to filesystem, launcher runtime
state/cache paths, network, MCP, and unsupported-platform checks. Sandboxed MCP
child diagnostics MUST include recent child-attributed violations even when
the violation command differs from the companion wrapper, while remote or
in-process MCPs MUST remain labeled as non-child operations. Pending live MCP
checks and final validation remain open until the runtime-path and diagnostic
attribution tasks, as well as prior cleanup tasks, pass; no live sandbox retry
is allowed before those tasks pass.

## Risks and Fallback

- Broad read compatibility means a local MCP can read more user data than the
  strict policy. With network access enabled, a compromised or misbehaving MCP
  may exfiltrate readable data. The UI and documentation must state this
  plainly.
- Write restrictions can still prevent an MCP from intentionally writing
  outside the active workspace. Such failures must remain visible and must not
  trigger an automatic unsandboxed retry.
- The sandbox runtime's network-on mode is a coarse unrestricted-network
  compatibility mode rather than a complete outbound-only confidentiality
  boundary. The companion server must still be launched on loopback, and the
  limitation must be documented until a stricter platform backend exists.
- If the compatibility sandbox cannot initialize, Chat remains unavailable
  rather than silently falling back to an unsandboxed companion. Users may
  explicitly disable Chat sandboxing to recover the prior behavior.

## Compatibility Impact

The default `inherit`/`on`/`off` behavior remains unchanged. When Chat
sandboxing is effective, existing local and remote MCP configurations gain a
single inherited compatibility policy instead of failing because their runtime
paths are absent from a strict read allowlist. Scout and Build OpenCode
permissions remain unchanged. Independent CLI/TUI sessions and VS Code-wide
Copilot sandbox settings remain unaffected.
