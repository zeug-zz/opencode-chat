## MODIFIED Requirements

### Requirement: Sandboxed filesystem policy

When Chat sandboxing is enabled, the companion SHALL use a compatibility-first
filesystem policy. The policy SHALL permit read access required by the
companion, configured local MCPs, and their installed runtimes without
requiring MCP-specific path grants. The policy SHALL constrain writes to the
active workspace and the OpenCode state, runtime-cache, and temporary paths
required for Chat operation. The policy SHALL NOT grant arbitrary home-
directory write access or silently fall back to an unsandboxed process.

#### Scenario: Workspace access is preserved

- **WHEN** the Chat companion is sandboxed
- **THEN** permitted reads and writes in the active workspace SHALL continue to
  work
- **AND** the existing Scout and Build agent permission behavior SHALL remain
  unchanged

#### Scenario: Local MCP runtime access is preserved

- **WHEN** a configured local MCP requires an installed executable, language
  runtime, package, cache, or configuration file to start
- **THEN** the MCP SHALL be able to read the required path under the
  compatibility policy without a server-specific filesystem exception
- **AND** the MCP process SHALL remain a child of the sandboxed companion

#### Scenario: Outside filesystem access is denied

- **WHEN** a companion shell or MCP process attempts to write outside the
  active workspace or explicitly required OpenCode/runtime/temp paths
- **THEN** the operation SHALL fail at the sandbox boundary
- **AND** the extension SHALL surface the failure without broadening write
  access automatically
- **AND** reads required by an installed runtime or dependency SHALL not fail
  solely because the path is absent from a strict home-directory read
  allowlist

#### Scenario: Required runtime paths are unavailable

- **WHEN** OpenCode or an enabled MCP requires a write path that is not part of
  the compatibility policy
- **THEN** the affected operation SHALL report a visible failure
  - **AND** the extension SHALL not replace the missing permission with broad
  home-directory write access

#### Scenario: Supported local launcher runtime state is available

- **WHEN** a sandboxed local MCP uses UV runtime data, state, or cache files
- **THEN** the compatibility policy SHALL grant only the applicable derived
  directories `~/.local/share/uv` and `~/.cache/uv` on POSIX, and
  `~/Library/Application Support/uv` and `~/Library/Caches/uv` on macOS
- **AND** the policy SHALL not grant the home-directory root or unrelated
  home paths
- **AND** independent OpenCode CLI/TUI processes SHALL remain outside the
  Chat companion's policy and teardown boundary

#### Scenario: OpenCode and context-mode runtime state is available

- **WHEN** a sandboxed Chat companion or its context-mode tooling requires
  runtime lock/state or session database writes
- **THEN** the compatibility policy SHALL grant only the OpenCode directory
  derived from `XDG_STATE_HOME/opencode` or `~/.local/state/opencode`
- **AND** it SHALL grant only the context-mode sessions directory derived from
  `XDG_CONFIG_HOME/opencode/context-mode/sessions` or
  `~/.config/opencode/context-mode/sessions`
- **AND** XDG overrides SHALL take precedence over the default paths
- **AND** the policy SHALL not grant the home-directory root, the whole
  `~/.config/opencode` directory, or credential-store paths
- **AND** denial of `opencode-notifier-state.json` SHALL be treated as
  nonfatal diagnostic noise and SHALL remain outside this focused grant unless
  later evidence shows that it blocks Chat or MCP operation

#### Scenario: Context-mode and runtime temporary children are available

- **WHEN** context-mode or a runtime temp script creates a temporary
  child directory beneath the configured per-user macOS temporary root
- **THEN** the compatibility policy SHALL derive that root from the configured
  temporary path and permit only the required child creation, including
  `.ctx-mode-*` children
- **AND** equivalent platform-safe temporary-root derivation SHALL be used on
  non-macOS platforms
- **AND** the policy SHALL not grant broad `/tmp` access, the home-directory
  root, or credential-store paths

### Requirement: Agent and execution boundaries remain explicit

Sandbox compatibility MUST NOT broaden agent-level tool permissions or expose
alternate code or shell execution to Scout or the Markdown-only Chat report
writer. Scout SHALL remain research/read-only, the report writer SHALL only
write Markdown reports, and full coding SHALL require the explicit
user-controlled `open in tui` handoff. Context-mode plugin/tool profiles and Bun
bootstrap are deferred to a follow-up OpenSpec change and MUST NOT be
implemented in this change.

#### Scenario: Compatibility does not broaden Scout or report-writer execution

- **WHEN** Chat sandbox compatibility is enabled
- **THEN** Scout SHALL retain research/read-only behavior
- **AND** the Markdown-only report writer SHALL remain limited to writing
  Markdown reports
- **AND** neither agent SHALL receive alternate code or shell execution through
  the compatibility layer

#### Scenario: Coding remains an explicit TUI handoff

- **WHEN** full coding is required from Chat
- **THEN** the user-controlled `open in tui` handoff SHALL remain the coding
  boundary
- **AND** context-mode plugin/tool profiles and Bun bootstrap SHALL not be
  implemented as part of this compatibility change

### Requirement: Explicit Chat network policy

The Chat sandbox SHALL apply one network policy to the entire companion process
tree, including providers, remote MCPs, local MCPs, shell tools, LSPs,
formatters, and their descendants. When `allowNetwork` is `false`, non-loopback
network requests from that tree SHALL be denied. When `allowNetwork` is `true`,
the compatibility layer SHALL permit unrestricted network use required by
providers and MCPs without server-specific domain configuration. The
compatibility layer SHALL launch the Chat companion API on loopback and SHALL
not retry denied requests outside the sandbox.

#### Scenario: Provider request without network access

- **WHEN** Chat sandboxing is enabled
- **AND** Chat network access is disabled
- **AND** OpenCode attempts to contact a remote model provider
- **THEN** the request SHALL fail with a network or sandbox error
- **AND** the companion and its MCP descendants SHALL remain sandboxed

#### Scenario: Research request with network access

- **WHEN** Chat sandboxing and network access are enabled
- **AND** OpenCode uses a remote MCP or research provider
- **THEN** the request SHALL be available to the companion process tree
- **AND** it SHALL not require an unsandboxed retry or MCP-specific network
  setting

#### Scenario: Local MCP network access inherits the global setting

- **WHEN** a sandboxed local MCP makes an outbound network request
- **THEN** the request SHALL follow the same Chat `allowNetwork` value as the
  companion
- **AND** the extension SHALL not require a server-name-specific network rule

#### Scenario: Network denial is not bypassed

- **WHEN** a sandboxed OpenCode tool or MCP encounters a denied network request
- **THEN** the extension SHALL surface the tool or MCP failure
- **AND** it SHALL NOT retry the request outside the sandbox automatically

### Requirement: Platform capability and policy boundaries

The compatibility sandbox policy SHALL be global to the sandboxed companion
process tree and independent of MCP server identity. Enabling or disabling an
MCP SHALL not require a policy rebuild, server-specific path exception, or
server-specific network rule. Local stdio MCP processes SHALL inherit the
companion's compatibility filesystem, network, and process restrictions.
Remote MCP behavior SHALL follow the global Chat network policy and SHALL not
receive a filesystem exemption.

The compatibility policy MAY permit broad filesystem reads to keep arbitrary
local MCP runtimes usable, but SHALL preserve write restrictions for the active
workspace and required runtime paths. It SHALL NOT automatically grant write
access to credential stores or the home-directory root. Linux SHALL use the
sandbox runtime's Linux backend and SHALL not rely on macOS Mach permissions.
Unsupported Windows environments SHALL report the sandbox as unavailable and
retain the existing unsandboxed launch path without claiming that sandboxing is
active.

#### Scenario: Local stdio MCP inherits the companion policy

- **WHEN** a sandboxed companion starts a local stdio MCP
- **THEN** the MCP child SHALL inherit the companion's process, filesystem,
  and network restrictions
- **AND** the MCP SHALL not require a path grant solely to read its installed
  runtime or dependencies
- **AND** writes outside the compatibility write policy SHALL remain denied

#### Scenario: Remote MCP follows network policy

- **WHEN** a remote MCP is used by the sandboxed companion
- **THEN** its outbound behavior SHALL follow `allowNetwork`
- **AND** allowing network access SHALL not add MCP-specific filesystem write
  access
- **AND** disabling network access SHALL not trigger an unsandboxed retry

#### Scenario: macOS adapter permits required DNS and TLS behavior narrowly

- **WHEN** macOS sandboxed Chat needs provider or MCP network traffic
- **THEN** the adapter SHALL apply the runtime's compatibility network mode
- **AND** network-disabled mode SHALL preserve the local-only boundary
- **AND** network-enabled mode SHALL not require a hard-coded domain list for
  ordinary provider or MCP use

#### Scenario: Windows reports unsupported sandboxing gracefully

- **WHEN** Chat sandboxing is requested on an unsupported Windows environment
- **THEN** the status SHALL report sandbox support as unavailable
- **AND** Chat SHALL use the existing unsandboxed launch path
- **AND** the status SHALL not report effective sandboxing as enabled

### Requirement: Sandboxed companion teardown is tree-complete

When a sandboxed Chat companion is stopped, disconnected, or replaced because
of a sandbox or network transition, the extension MUST terminate the complete
POSIX process group/tree owned by that companion. This MUST include the
wrapper/sandbox shell, `opencode serve`, local MCP processes, and all npm/node
or other MCP descendants. The extension MUST await bounded cleanup before
starting a replacement companion. Repeated transitions MUST NOT accumulate
MCP children, orphan old companion trees, or race the project database. This
requirement preserves the existing sandbox filesystem/network policy and does
not change the independent TUI process tree.

#### Scenario: Stopping terminates the complete companion tree

- **WHEN** a sandboxed Chat companion is stopped or disconnected
- **THEN** the extension SHALL send graceful termination to the detached POSIX
  process group containing the wrapper/sandbox shell and `opencode serve`
- **AND** the server and every MCP descendant, including npm/node children,
  SHALL terminate as part of that group
- **AND** the extension SHALL await cleanup before reporting teardown complete

#### Scenario: Stubborn descendants are forcefully cleaned up

- **WHEN** a member of the sandboxed companion process group remains alive after
  the bounded graceful-termination period
- **THEN** the extension SHALL escalate to SIGKILL for the process group
- **AND** SHALL await confirmation that the old companion tree is gone before
  allowing a replacement spawn

#### Scenario: Reconnect waits for teardown

- **WHEN** sandbox or network settings trigger a companion reconnect while the
  prior companion has not exited
- **THEN** the extension SHALL serialize the transition and defer replacement
  spawn until complete process-tree cleanup has finished
- **AND** repeated transitions SHALL not accumulate npm/node MCP children or
  race the project database

#### Scenario: Chat teardown does not terminate the TUI

- **WHEN** Chat stops or reconnects its sandboxed companion
- **THEN** the independent OpenCode CLI/TUI process tree SHALL remain running
  and unaffected
- **AND** Chat SHALL preserve the existing sandbox filesystem and network
  policy for the replacement companion

### Requirement: Sandbox and MCP diagnostics are actionable

The extension SHALL preserve actionable diagnostics for compatibility sandbox
violations and MCP child failures, including the affected child or operation,
startup/readiness context, exit status, and captured stderr/stdout subject to
existing secret-safety constraints. Diagnostics SHALL distinguish a denied
write or network operation from a generic companion connection failure.

#### Scenario: Sandbox violation is visible without policy broadening

- **WHEN** the companion or an MCP child hits a sandbox-denied write or network
  operation
- **THEN** Chat SHALL surface a diagnostic identifying the denied operation
- **AND** the companion SHALL remain under the configured compatibility policy
- **AND** the extension SHALL not retry outside the sandbox or silently widen
  write permissions

#### Scenario: MCP child startup failure includes child diagnostics

- **WHEN** a local MCP child exits early or fails readiness for a reason other
  than a strict read allowlist denial
- **THEN** Chat SHALL report the MCP child identity and exit context
- **AND** available child stderr/stdout SHALL be included in the diagnostic
- **AND** secrets SHALL not be copied into user-visible diagnostics

#### Scenario: Child-attributed sandbox violations survive command mismatch

- **WHEN** a sandboxed local MCP child fails and its recent sandbox violation
  record names a command different from the companion wrapper
- **THEN** the user-visible diagnostic SHALL include the recent violation when
  it is attributable to that child
- **AND** the diagnostic SHALL remain bounded and redacted
- **AND** remote or in-process MCP failures SHALL be labeled as such and SHALL
  not be mislabeled as child-process failures

#### Scenario: MCP diagnostics remain visible and selectable in the Gear panel

- **WHEN** a local or remote MCP diagnostic contains long error text, filesystem
  paths, or URLs
- **THEN** the complete bounded and redacted diagnostic SHALL remain visible in
  the Gear panel without horizontal clipping
- **AND** the diagnostic text SHALL wrap within the panel
- **AND** the diagnostic text SHALL remain selectable and copyable in the
  webview
