## MODIFIED Requirements

### Requirement: Sandboxed filesystem policy

When Chat sandboxing is enabled, the companion SHALL use a compatibility-first
filesystem policy. The policy SHALL permit read access required by the
companion, configured local MCPs, and their installed runtimes without
requiring MCP-specific path grants, except for the protected read baseline
specified below. The policy SHALL constrain writes to the active workspace and
the OpenCode state, runtime-cache, and temporary paths required for Chat
operation. The sandboxed Chat MUST be able to write the narrow OpenCode
lock/state directory derived from `XDG_STATE_HOME/opencode` or
`~/.local/state/opencode`, and the narrow context-mode sessions directory
derived from `XDG_CONFIG_HOME/opencode/context-mode/sessions` or
`~/.config/opencode/context-mode/sessions`. The policy SHALL NOT grant
arbitrary home-directory write access or silently fall back to an unsandboxed
process. For runtime-created temporary children, the policy SHALL derive the
per-user macOS temporary root from the configured `<tempRoot>/opencode` path
and preserve equivalent platform-safe behavior on non-macOS platforms.

When the effective platform sandbox is macOS or Linux, the companion and its
descendants SHALL receive an expanded, static, reviewed baseline of narrow
sensitive-data leaf paths. The baseline SHALL cover credentials,
shell history and configuration, browser and private application data, and
platform-specific keychains or password stores. It SHALL retain the existing
cross-platform protected paths relative to the effective home directory,
including `.ssh`, `.gnupg`, `.aws`, `.azure`, `.config/gcloud`, `.gcloud`,
`.kube`, `.docker`, `.git-credentials`, `.netrc`, `.npmrc`, `.bunfig.toml`,
`.config/bun/bunfig.toml`, `.vault-token`, `.credentials`, `.secrets`, `.keys`,
`.pki`, `.terraform.d`, `.config/op`, shell history and configuration files,
`.config/fish`, `.env`, and `.envrc`. It SHALL also retain the reviewed
platform-specific macOS and Linux keychain, password-store, browser, and
private-application protections, while adding only the reviewed narrow leaf
paths in those same sensitive-data classes rather than broad parent-directory
denies.

On macOS, the baseline SHALL additionally deny `~/Library/Keychains`,
`/Library/Keychains`, `~/.password-store`, `~/.1password`,
`~/Library/Group Containers/2BUA8C4S2C.com.1password`,
`~/Library/Application Support/1Password`,
`~/Library/Containers/com.1password.1password`,
`~/Library/Application Support/Google/Chrome`,
`~/Library/Application Support/Chromium`,
`~/Library/Application Support/Firefox`,
`~/Library/Application Support/Microsoft Edge`,
`~/Library/Application Support/Arc`,
`~/Library/Application Support/BraveSoftware`,
`~/Library/Application Support/Vivaldi`,
`~/Library/Application Support/com.operasoftware.Opera`, `~/Library/Safari`,
`~/Library/Messages`, `~/Library/Mail`, `~/Library/Cookies`,
`~/Library/Containers/com.apple.Safari`, and
`~/Library/Application Support/MobileSync`, together with the reviewed
macOS leaf paths in those protected classes.

On Linux, the baseline SHALL additionally deny `~/.password-store`,
`~/.1password`, `~/.op`, `~/.local/share/keyrings`,
`~/.config/google-chrome`, `~/.config/chromium`, `~/.mozilla/firefox`,
`~/.config/microsoft-edge`, `~/.config/BraveSoftware`,
`~/.config/vivaldi`, and `~/.config/opera`, together with the reviewed Linux
leaf paths in the protected credential, shell, browser, private-application,
keychain, and password-store classes.

The baseline SHALL be derived from the effective home directory, normalized,
deduplicated, and applied deterministically. It SHALL remain limited to
supported macOS/Linux environments, SHALL not require nono to be installed or
inspect user-specific nono profiles, and SHALL not introduce new network
rules. Required workspace, OpenCode configuration/state/cache, executable or
PATH dependency, runtime-cache, temporary, and other documented compatibility
read grants SHALL remain available when non-conflicting. Any exact, ancestor,
or descendant overlap between a protected deny path and a required read grant
SHALL fail before sandbox launch with an actionable error; the system SHALL
not remove the deny, broaden the grant, or silently fall back unsandboxed.
Reads and writes outside the reviewed baseline SHALL preserve existing
compatibility behavior, subject to existing sandbox limitations. Newly
protected paths may affect MCPs that intentionally read them; this is an
explicit compatibility tradeoff, while core Chat and Write operation remains
available for non-conflicting paths.

The policy SHALL not introduce a `reports/` directory convention, a
host-mediated or staging writer, exact report-path enforcement, MCP-specific
filesystem allowlists, or a change to Build's broad workspace-scoped edit
behavior. Write's requested-artifact restriction SHALL remain behavioral and
not become a technical report-only restriction.

#### Scenario: Expanded macOS baseline denies reviewed sensitive leaves

- **WHEN** Chat sandboxing is enabled on macOS
- **THEN** the companion SHALL receive the existing macOS protected paths and
  the expanded reviewed narrow leaf paths for credentials, shell history and
  configuration, browser and private application data, and keychains or
  password stores
- **AND** reads of each protected path SHALL fail at the sandbox boundary
- **AND** the baseline SHALL not be replaced by a broad home-directory deny

#### Scenario: Workspace access is preserved

- **WHEN** the Chat companion is sandboxed
- **THEN** permitted reads and writes in the active workspace SHALL continue to
  work
- **AND** the existing Scout and Build agent permission behavior SHALL remain
  unchanged

#### Scenario: Local MCP runtime access is preserved

- **WHEN** a configured local MCP requires an installed executable, language
  runtime, package, cache, or configuration file to start
- **AND** the required path is not within the expanded protected read baseline
- **THEN** the MCP SHALL be able to read the required path under the
  compatibility policy without a server-specific filesystem exception
- **AND** the MCP process SHALL remain a child of the sandboxed companion

#### Scenario: Expanded Linux baseline denies reviewed sensitive leaves

- **WHEN** Chat sandboxing is enabled on Linux
- **THEN** the companion SHALL receive the existing Linux protected paths and
  the expanded reviewed narrow leaf paths for credentials, shell history and
  configuration, browser and private application data, and keychains or
  password stores
- **AND** reads of each protected path SHALL fail at the sandbox boundary
- **AND** the baseline SHALL not be replaced by a broad home-directory deny

#### Scenario: Protected baseline is platform-aware

- **WHEN** Chat sandboxing is enabled on macOS or Linux
- **THEN** the deny paths SHALL be resolved from the configured effective home
  directory, normalized, deduplicated, and emitted deterministically
- **AND** macOS-only paths SHALL not be emitted on Linux
- **AND** Linux-only paths SHALL not be emitted on macOS
- **AND** the deny paths SHALL be resolved from the configured home directory
- **AND** the deny paths SHALL be normalized, deduplicated, and emitted
  deterministically
- **AND** the expanded baseline SHALL not be emitted as an enforcement claim
  on Windows

#### Scenario: Required compatibility grants remain available

- **WHEN** a workspace, OpenCode configuration/state/cache path, executable or
  PATH dependency, runtime cache, temporary path, or other documented
  compatibility path does not conflict with the protected baseline
- **THEN** the companion SHALL retain the required read access
- **AND** permitted workspace and runtime reads and writes SHALL continue to
  work without an MCP-specific filesystem exception

#### Scenario: Deny and required grants cannot overlap

- **WHEN** a protected deny path and a required read grant exactly match, or
  either path is an ancestor or descendant of the other
- **THEN** filesystem policy construction SHALL fail before the companion
  starts
- **AND** the failure SHALL identify the conflicting policy boundary
- **AND** the extension SHALL not replace the conflict with a broad home grant
- **AND** the system SHALL not remove the deny, broaden the grant, or launch
  unsandboxed

#### Scenario: Outside filesystem access is denied

- **WHEN** a companion shell or MCP process attempts to write outside the
  active workspace or explicitly required OpenCode/runtime/temp paths
- **THEN** the operation SHALL fail at the sandbox boundary
- **AND** the extension SHALL surface the failure without broadening write
  access automatically
- **AND** reads required by an installed runtime or dependency outside the
  protected baseline SHALL not fail solely because the path is absent from a
  strict home-directory read allowlist

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
- **AND** denial of `opencode-notifier-state.json` SHALL be treated as nonfatal
  diagnostic noise and SHALL remain outside this focused grant unless later
  evidence shows that it blocks Chat or MCP operation

#### Scenario: Context-mode and runtime temporary children are available

- **WHEN** context-mode, Bun, or a runtime temp script creates a temporary child
  directory beneath the configured `<tempRoot>/opencode` path on macOS
- **THEN** the compatibility policy SHALL derive the per-user temporary root
  from that configured path
- **AND** it SHALL permit `.ctx-mode-*` sibling creation only when the root is
  validated as `/var/folders/<two-char-user>/<per-user-id>/T` or the equivalent
  `/private/var/folders/<two-char-user>/<per-user-id>/T` root
- **AND** the policy SHALL not grant broad `/tmp` or `/private/tmp` access, the
  home-directory root, credential-store paths, or arbitrary parent paths
- **AND** equivalent platform-safe temporary-root derivation SHALL be used on
  non-macOS platforms

#### Scenario: Local MCP compatibility outside the baseline is preserved

- **WHEN** a configured local MCP requires an installed executable, language
  runtime, package, cache, configuration file, or temporary path to start
- **AND** the required path is not within the protected baseline
- **THEN** the MCP SHALL be able to read or write the required path under the
  existing compatibility policy
- **AND** writes outside the active workspace and explicitly required
  OpenCode, runtime, or temporary paths SHALL remain denied

#### Scenario: Protected baseline reads are denied

- **WHEN** the companion, a shell tool, or a local MCP child attempts to read
  a path in the platform-appropriate expanded baseline
- **THEN** the read SHALL fail at the sandbox boundary
- **AND** the failure SHALL be inherited by the companion's descendants
- **AND** the extension SHALL not broaden read or write access automatically

#### Scenario: Sandbox launch does not fall back unsandboxed

- **WHEN** construction or launch of the enabled macOS/Linux sandbox fails,
  including because of a deny/grant overlap
- **THEN** Chat SHALL report a visible failure and remain unavailable
- **AND** the extension SHALL terminate any partial child process
- **AND** it SHALL not remove protected denies, broaden grants, or start an
  unsandboxed replacement

#### Scenario: Existing runtime paths remain available

- **WHEN** a sandboxed Chat companion or its context-mode tooling requires
  runtime lock/state, session database, UV cache, npm cache, or temporary
  child paths
- **THEN** the compatibility policy SHALL retain the applicable derived paths
  and existing XDG, UV, and platform-safe temporary-root behavior
- **AND** it SHALL not grant the home-directory root, unrelated home paths,
  or protected credential-store paths

#### Scenario: Agent boundaries and write scope are unchanged

- **WHEN** the expanded sandbox baseline is active
- **THEN** Scout and Write agent-level behavior SHALL remain unchanged
- **AND** Build SHALL retain its broad workspace-scoped edit capability
- **AND** Write's requested-artifact restriction SHALL remain behavioral
- **AND** no reports directory, writer proxy, staging layer, exact report path,
  or MCP-specific filesystem allowlist SHALL be required

### Requirement: Sandboxed companion process tree

When Chat sandboxing is enabled, the OpenCode companion server SHALL run inside
the platform sandbox and every shell tool, local MCP process, LSP, formatter,
or other child process launched by that server SHALL inherit the same
restrictions. The VS Code extension host and webview SHALL remain outside the
sandbox. The expanded protected-read baseline SHALL apply to the complete
companion process tree, including local MCP descendants.

#### Scenario: Companion tools inherit the sandbox

- **WHEN** the sandboxed companion launches a shell tool or local MCP process
- **THEN** the child process SHALL inherit the companion filesystem and network
  restrictions
- **AND** the inherited filesystem restrictions SHALL include the expanded
  protected-read baseline
- **AND** the child SHALL NOT gain access merely because it was launched by
  OpenCode

#### Scenario: Local MCP descendants cannot bypass protected reads

- **WHEN** a local MCP launches a descendant that attempts to read a newly
  protected path
- **THEN** the descendant's read SHALL be denied by the same sandbox boundary
- **AND** no MCP identity or child relationship SHALL grant an exception

#### Scenario: Extension host remains available

- **WHEN** Chat sandboxing is enabled
- **THEN** the extension host SHALL continue to perform VS Code UI operations
  such as opening editors, showing diffs, and communicating with the webview
- **AND** the sandbox policy SHALL not be applied to unrelated VS Code
  extensions

#### Scenario: Loopback Chat connection remains functional

- **WHEN** the sandboxed companion binds its local API server
- **THEN** it SHALL bind to loopback only
- **AND** the extension host SHALL be able to connect to that loopback server
- **AND** the sandbox SHALL not expose the companion API to non-loopback
  inbound connections

### Requirement: Agent and execution boundaries remain explicit

Sandbox compatibility MUST NOT broaden agent-level tool permissions or expose
alternate code or shell execution to Scout or the Markdown-only Chat report
writer. Scout SHALL remain research/read-only, the report writer SHALL only
write Markdown reports, and full coding SHALL require the explicit
user-controlled `open in tui` handoff. Context-mode plugin/tool profiles and
Bun bootstrap are deferred to a separate change and MUST NOT be implemented
as part of this compatibility change. The expanded protected-read baseline
SHALL not introduce a reports directory convention, host-mediated or staging
writer, exact report-path enforcement, or a technical report-only edit
boundary. Build SHALL retain its broad workspace-scoped `edit: "allow"`
capability.

#### Scenario: Compatibility does not broaden Scout or report-writer execution

- **WHEN** Chat sandbox compatibility is enabled or its protected-read
  baseline is expanded
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

#### Scenario: Write remains behavioral rather than report-only technically

- **WHEN** Write handles a requested artifact while the expanded baseline is
  active
- **THEN** its requested-artifact restriction SHALL remain an agent behavior
- **AND** the extension SHALL not impose exact report-path enforcement, a
  reports directory convention, or a host-mediated writer
- **AND** Build's broad workspace-scoped edit capability SHALL remain unchanged

### Requirement: Platform capability and policy boundaries

The compatibility sandbox policy SHALL be global to the sandboxed companion
process tree and independent of MCP server identity. Enabling or disabling an
MCP SHALL not require a policy rebuild, server-specific path exception, or
server-specific network rule. Local stdio MCP processes SHALL inherit the
companion's compatibility filesystem, network, and process restrictions,
including the expanded protected-read baseline. Remote MCP behavior SHALL
follow the global Chat network policy and SHALL not receive a filesystem
exemption.

The compatibility policy MAY permit broad filesystem reads to keep arbitrary
local MCP runtimes usable, but SHALL preserve write restrictions for the active
workspace and required runtime paths. It SHALL NOT automatically grant write
access to credential stores or the home-directory root. Linux SHALL use the
sandbox runtime's Linux backend and SHALL not rely on macOS Mach permissions.
The expanded deny-read baseline SHALL be enforced only on supported macOS and
Linux launches. Unsupported Windows environments SHALL report the sandbox as
unavailable and retain the existing unsandboxed launch path without claiming
that the baseline or any sandbox read denial is active.

#### Scenario: Local stdio MCP inherits the companion policy

- **WHEN** a sandboxed companion starts a local stdio MCP
- **THEN** the MCP child SHALL inherit the companion's expanded protected-read,
  compatibility filesystem, network, and process restrictions
- **AND** the MCP SHALL not require a path grant solely to read its installed
  runtime or dependencies outside the protected baseline
- **AND** writes outside the compatibility write policy SHALL remain denied

#### Scenario: Remote MCP follows network policy

- **WHEN** a remote MCP is used by the sandboxed companion
- **THEN** its outbound behavior SHALL follow `allowNetwork`
- **AND** allowing remote network access SHALL not broaden filesystem access
- **AND** disabling network access SHALL not trigger an unsandboxed retry

#### Scenario: Windows reports unsupported sandboxing gracefully

- **WHEN** Chat sandboxing is requested on an unsupported Windows environment
- **THEN** the status SHALL report sandbox support as unavailable
- **AND** Chat SHALL use the existing unsandboxed launch path
- **AND** no expanded or existing deny-read baseline SHALL be emitted as an
  enforcement policy
- **AND** the status SHALL not report effective sandboxing as enabled

#### Scenario: macOS adapter permits required DNS and TLS behavior narrowly

- **WHEN** macOS sandboxed Chat needs DNS resolution or TLS/provider traffic
- **THEN** the adapter SHALL apply the runtime's compatibility network mode
- **AND** network-disabled mode SHALL preserve the local-only boundary
- **AND** network-enabled mode SHALL not require a hard-coded domain list for
  ordinary provider or MCP use

### Requirement: Sandbox failures fail closed

When Chat sandboxing is enabled, failure to initialize, start, connect to, or
maintain the sandboxed companion SHALL make Chat unavailable with a visible
error. The extension SHALL not silently fall back to an unsandboxed companion.
This includes failure caused by construction or validation of the expanded
protected-read baseline and required-grant overlap.

#### Scenario: Sandboxed startup fails

- **WHEN** the sandbox runtime, protected-read policy, or companion fails before
  readiness
- **THEN** the extension SHALL terminate any partial child process
- **AND** it SHALL show a meaningful Chat connection error
- **AND** it SHALL not remove a protected deny, broaden a required grant, or
  start an unsandboxed replacement

#### Scenario: Sandboxed companion exits unexpectedly

- **WHEN** the sandboxed companion exits after becoming ready
- **THEN** the extension SHALL detect the lost process
- **AND** it SHALL report that Chat is unavailable
- **AND** it SHALL not silently launch an unsandboxed replacement

#### Scenario: User explicitly selects an unsandboxed Chat mode after failure

- **WHEN** the user explicitly selects `opencode-chat.chatSandbox.mode` as `off`
  after a sandboxed startup failure
- **THEN** the extension MAY restore the existing unsandboxed companion path
- **AND** the panel SHALL show the resulting disabled sandbox state
