## Context

The current sandboxed Chat companion is launched once through
`@vscode/sandbox-runtime`, so the OpenCode server and all of its local MCP,
shell, LSP, and formatter descendants already share one process boundary. The
failure is in the filesystem policy layered onto that boundary: the policy
denies the home directory and then re-allows a small set of known paths. That
model cannot support arbitrary user-installed MCP runtimes without either
discovering every dependency or adding server-specific exceptions.

See `proposal.md` for the motivation and
`specs/chat-agent-sandbox/spec.md` for the compatibility contract.

## Goals / Non-Goals

**Goals:**

- Make ordinary local and remote MCP configurations usable when Chat sandboxing
  is enabled, without MCP-name-specific policy code.
- Keep one global network setting for the complete companion process tree.
- Retain a meaningful write boundary around the active workspace and required
  OpenCode/runtime state.
- Preserve the existing extension-owned settings, lifecycle restart behavior,
  agent overlay, MCP preferences, session persistence, and fail-closed startup.
- Make the weaker security boundary explicit in user-facing documentation.
- Keep agent-level permissions and execution boundaries unchanged: Scout remains
  research/read-only, the Chat report writer only writes Markdown reports, and
  full coding requires the explicit user-controlled `open in tui` handoff.

**Non-Goals:**

- Strong confidentiality from local MCPs or shell processes that can read user
  files.
- Per-MCP path grants, credential-store brokers, or automatic strict-policy
  discovery.
- Broad arbitrary write access to the home directory.
- Changes to independent OpenCode CLI/TUI processes or VS Code-wide agent
  sandbox settings.
- Solving the future advanced strict-sandbox UX in this change.
- Bootstrapping context-mode plugins or defining context-mode plugin/tool
  profiles; those are deferred to a follow-up OpenSpec change.

## Decisions

### 1. Keep a single inherited sandbox policy

The extension will continue to wrap `opencode serve` once. Local stdio MCPs do
not receive separate sandbox settings: they inherit the companion policy by
process ancestry. Remote MCPs use the same network policy because their
requests originate from the companion process.

This is preferred over MCP-specific toggles because it matches the actual
security boundary and keeps the user-facing model to the existing two controls:
Chat sandbox enabled and network access enabled.

### 2. Use compatibility filesystem semantics

The compatibility filesystem policy will stop denying reads under the home
directory. It will not build `denyRead` and `allowRead` rules from a finite list
of MCP or runtime paths. This allows common command runners and arbitrary
installed MCP dependencies to start without knowing whether they use Node,
Python, uv, npm, Bun, Rust, or another runtime.

Write access remains an allowlist containing:

- The active workspace.
- OpenCode state, cache, and temporary paths.
- Runtime caches required by the existing companion launch path.

The policy SHALL also include exact derived runtime state/cache directories
needed by supported local launchers: POSIX `~/.local/share/uv` and
`~/.cache/uv`, plus macOS `~/Library/Application Support/uv` and
`~/Library/Caches/uv`. These grants SHALL be emitted only for the derived
directories that exist or are applicable on the platform; they SHALL never be
implemented as a home-root grant or a grant that changes independent TUI
ownership/isolation.

The policy SHALL also include the exact OpenCode runtime-state directory derived
from `XDG_STATE_HOME/opencode` or `~/.local/state/opencode`, and the exact
context-mode session directory derived from
`XDG_CONFIG_HOME/opencode/context-mode/sessions` or
`~/.config/opencode/context-mode/sessions`. XDG overrides SHALL take precedence
when present. These are narrow directory grants for lock/state and session DB
writes only; the policy SHALL not grant the home root, the whole
`~/.config/opencode` directory, or credential-store paths. The observed
`opencode-notifier-state.json` denial is nonfatal diagnostic noise and remains
outside this focused grant unless later evidence shows it blocks Chat or MCP
operation.

The policy SHALL derive the per-user temporary root from the configured
temporary path on macOS and permit the narrow child creation required by
  context-mode and runtime temporary scripts, including `.ctx-mode-*`
children. Other platforms SHALL use equivalent platform-safe temporary-root
derivation. This MUST NOT become a grant for `/tmp`, the home root, or
credential stores. The configured temporary path remains the source of truth;
the policy SHALL not hard-code a broad system temporary directory.

The observed `opencode-notifier-state.json` denial remains nonfatal diagnostic
noise unless new evidence shows that it blocks Chat or MCP operation.

### 2a. Preserve agent and execution boundaries

Sandbox compatibility MUST NOT broaden agent-level tool permissions or expose
alternate code or shell execution to Scout or the Markdown-only Chat report
writer. Scout remains research/read-only, the report writer only writes
Markdown reports, and full coding remains available only through the explicit
user-controlled `open in tui` handoff. Context-mode plugin/tool profiles and Bun
bootstrap are intentionally deferred to a follow-up OpenSpec change and MUST
NOT be implemented here.

The policy builder will continue to normalize paths and reject a home-directory
root or credential-store write path. No MCP configuration is parsed to infer
additional write privileges, so a local MCP that intentionally writes outside
the active workspace remains subject to the write boundary.

The alternative of granting every configured MCP root write access was rejected
for this change because command arguments are not a reliable or safe generic
capability declaration. A future strict mode can add an explicit approval
model without making compatibility mode dependent on it.

### 3. Keep network control global and coarse

With `allowNetwork: false`, the existing restricted-network runtime path will
continue to allow loopback operation needed by the companion and deny ordinary
remote provider/MCP traffic.

With `allowNetwork: true`, the runtime will use its unrestricted compatibility
network path while filesystem write restrictions remain active. The server
command will continue to use `--hostname 127.0.0.1` for the Chat API. This mode
does not claim strict outbound-only or credential-confidential behavior; that
requires a stronger platform backend than the current runtime toggle provides.

No MCP-specific domain list will be generated. This avoids turning a global
network option into a maintenance list of provider and MCP hostnames.

### 4. Preserve diagnostics without adding policy exceptions

The agent will retain bounded, redacted companion stdout/stderr and sandbox
violation information. MCP status failures will include the affected server,
available child/startup context, and relevant sandbox diagnostics. A diagnostic
will explain that a denied write or network operation is a compatibility-policy
failure, not silently convert it into an unsandboxed retry.

When a sandboxed local MCP child fails, diagnostic assembly SHALL fall back to
recent sandbox violations attributed to that child even when the recorded
violation command differs from the companion wrapper command. Attribution and
output SHALL remain bounded and redacted. Remote and in-process MCP failures
SHALL be labeled as remote/in-process operations and SHALL NOT be mislabeled as
child-process failures merely because they share the companion's diagnostics.

Diagnostics are preferred over automatic path expansion because compatibility
mode must remain predictable and must not silently become an unrestricted write
sandbox.

Diagnostic output remains bounded and redacted for secret safety, but the
resulting text MUST be rendered in the webview so users can see and select/copy
the complete bounded diagnostic. Long local/remote MCP error text, paths, and
URLs MUST wrap within the Gear panel rather than being horizontally clipped.

### 5. Keep settings and lifecycle unchanged

The existing `inherit`, `on`, and `off` resolution remains authoritative. A
change to the effective mode or network setting still serializes a companion
restart through `ChatSandboxController`. The controller will not gain MCP-name
or path-specific state.

The lifecycle boundary is tree-complete. On macOS/Unix, the sandbox spawn MUST
create a detached process-group leader for the wrapper/sandbox shell and
`opencode serve`. Stopping or reconnecting MUST signal that group with SIGTERM,
wait for a bounded grace period, escalate to SIGKILL when members remain, and
await process-group cleanup before resolving teardown or spawning a
replacement. Cleanup covers the server and every MCP descendant, including
npm/node children. Repeated transitions MUST be serialized so no replacement
can start while the previous tree is alive; this prevents orphan processes and
project-database races. This change does not add or claim Windows support for
the current sandbox path. Independent CLI/TUI processes remain outside this
controller-owned group and are never terminated by Chat teardown.

The webview will continue to show the existing controls, but the descriptions
will explain that the enabled sandbox is compatibility-oriented and that local
MCPs inherit it automatically.

### 6. Verify real MCP behavior, not only policy objects

Verification will cover both a generic nested child and representative
configured MCPs. The test matrix will include:

- Process-group teardown on stop, disconnect, and reconnect, including SIGTERM,
  bounded waiting, SIGKILL escalation, and confirmation that no wrapper,
  sandbox shell, server, or MCP descendants remain before replacement spawn.
- Deferred-exit reconnect coverage proving a replacement cannot start until
  cleanup completes, plus repeated-transition checks for npm/node accumulation
  and project-database races.

- A local MCP launched through the Node/npm runtime currently used by the
  workspace.
- A local MCP launched through uv or another non-Node runner.
- A filesystem MCP with a declared root outside the active workspace, verifying
  startup/read behavior and write confinement separately.
- A remote MCP/provider request with network access enabled.
- The same remote request with network access disabled, verifying failure stays
  inside the sandbox.
- Companion and MCP cleanup after disconnect and settings transitions.

The lifecycle strategy and regression matrix are macOS/Unix-only for the
current sandbox path; no Windows support claim is made. Independent TUI
operation will be verified to remain unaffected.

Live MCP checks will record status and bounded, redacted diagnostic output
without recording credential values. They remain pending until runtime
state/cache grants, child-violation attribution, and process-tree cleanup
implementation/tests pass. The final validation MUST rerun git and
paper-search with sandbox network enabled, and Context7 with network enabled
and disabled as applicable, confirming local-vs-remote labeling; no live
sandbox retry is permitted before those implementation tasks pass. Brave's
missing `BRAVE_API_KEY` launch environment remains explicitly outside this
change's code scope.

## Risks / Trade-offs

- [Broad read access] A local MCP can read user files that the strict policy
  would deny. The UI and README will state that network-enabled compatibility
  mode is not a credential-confidentiality boundary.
- [MCP write limitations] MCPs configured to write outside the active workspace
  may connect but fail individual write operations. Diagnostics will identify
  the denied write; no automatic broadening or unsandboxed retry is allowed.
- [Coarse network-on behavior] The current runtime's unrestricted network mode
  is broader than a strict outbound-only policy. The limitation is documented
  and kept out of the advanced-sandbox promise.
- [Runtime packaging] The sandbox runtime remains platform-specific and
  preview-oriented. Existing package, VSIX, and macOS smoke verification remain
  required.
- [User expectation] The word sandbox can imply stronger confidentiality than
  this mode provides. Documentation will call it a compatibility sandbox and
  contrast it with the deferred strict mode.

## Migration Plan

1. Change the enabled Chat sandbox filesystem policy to compatibility semantics
   while leaving the existing settings and launch lifecycle unchanged.
2. Update policy, agent, host, and integration tests for broad reads,
   constrained writes, inherited MCP behavior, and both network states.
3. Update the root and extension README files before packaging so the weaker
   boundary is visible to users.
4. Run focused tests, live MCP checks, `npm run check`, `npm run build`, and
   VSIX packaging verification.
5. If compatibility mode is not acceptable, set Chat sandbox mode to `off` to
   restore the existing unsandboxed companion path while the future strict mode
   is designed.

Rollback is configuration-first: users can disable Chat sandboxing. A code
rollback restores the prior strict policy implementation without changing
global/project MCP configuration or independent CLI/TUI behavior.

## Open Questions

None. The strict read-isolation and advanced grant model are intentionally
deferred to a separate change rather than left as decisions inside this
compatibility layer.
