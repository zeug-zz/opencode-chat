## MODIFIED Requirements

### Requirement: Sandboxed filesystem policy

When Chat sandboxing is enabled, the companion SHALL use the existing
compatibility-first filesystem policy for OpenCode, inherited plugins, configured
local MCPs, and their installed runtimes. The policy SHALL permit required reads
without plugin-name-specific or MCP-name-specific read grants. The policy SHALL
constrain writes to the active workspace and the existing OpenCode state,
runtime-cache, and temporary paths required for Chat operation. The policy SHALL
NOT grant arbitrary home-directory writes, silently expand writes for a plugin,
or silently fall back to an unsandboxed process.

#### Scenario: Inherited plugin reads use generic compatibility access

- **WHEN** an inherited plugin requires its source, dependency, or configuration
  to be read by the sandboxed companion
- **THEN** the compatibility policy SHALL treat it like an installed MCP
  runtime read
- **AND** no plugin-specific read allowlist entry SHALL be required

#### Scenario: Inherited plugin writes remain bounded

- **WHEN** an inherited plugin requires a write path outside the active
  workspace, OpenCode state/cache/temp, or existing runtime-cache grants
- **THEN** the write SHALL fail at the sandbox boundary
- **AND** the policy SHALL not grant the plugin's home or package root writable
  access automatically

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
- **AND** the required path is not within the protected read baseline
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

#### Scenario: Protected baseline reads are denied

- **WHEN** a sandboxed companion, shell, or local MCP attempts to read a path in
  the platform-appropriate protected read baseline
- **THEN** the read SHALL fail at the sandbox boundary
- **AND** the failure SHALL be inherited by descendants of the companion
- **AND** the extension SHALL not broaden read or write access automatically

#### Scenario: Protected baseline is platform-aware

- **WHEN** Chat sandboxing is enabled on macOS or Linux
- **THEN** the companion SHALL receive the corresponding static platform-aware
  deny paths
- **AND** the deny paths SHALL be resolved from the configured effective home
  directory, normalized, deduplicated, and emitted deterministically
- **AND** macOS-only paths SHALL not be emitted on Linux
- **AND** Linux-only paths SHALL not be emitted on macOS
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
  runtime lock/state, indexed-content, or session database writes
- **THEN** the compatibility policy SHALL grant only the OpenCode directory
  derived from `XDG_STATE_HOME/opencode` or `~/.local/state/opencode`
- **AND** it SHALL grant only the context-mode content and sessions directories
  derived from `CONTEXT_MODE_DIR/content` and `CONTEXT_MODE_DIR/sessions` when
  that override is set, or from the configured XDG/default context-mode paths
- **AND** XDG overrides SHALL take precedence over the default paths
- **AND** the policy SHALL not grant the home-directory root, the whole
  `~/.config/opencode` directory, or credential-store paths
- **AND** denial of `opencode-notifier-state.json` SHALL be treated as nonfatal
  diagnostic noise

#### Scenario: Context-mode and runtime temporary children are available

- **WHEN** context-mode, Bun, or a runtime temp script creates a temporary child
  directory beneath the configured `<tempRoot>/opencode` path on macOS
- **THEN** the compatibility policy SHALL derive the per-user temporary root
  from that configured path
- **AND** it SHALL permit `.ctx-mode-*` sibling creation only when the root is
  validated as a per-user macOS temporary root
- **AND** the policy SHALL not grant broad `/tmp` or `/private/tmp` access,
  the home-directory root, credential-store paths, or arbitrary parent paths
- **AND** equivalent platform-safe temporary-root derivation SHALL be used on
  non-macOS platforms

#### Scenario: Local MCP compatibility outside the baseline is preserved

- **WHEN** a configured local MCP requires an installed executable, language
  runtime, package, cache, configuration file, or temporary path to start
- **AND** the required path is not within the protected baseline
- **THEN** the MCP SHALL be able to read or write the required path under the
  existing compatibility policy
- **AND** writes outside the active workspace and explicitly required OpenCode,
  runtime, or temporary paths SHALL remain denied

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

#### Scenario: Compatibility grants remain generic for inherited plugins

- **WHEN** an inherited plugin reads a non-protected installed runtime or
  dependency path
- **THEN** the plugin SHALL use the same compatibility grant semantics as local
  MCPs
- **AND** the policy SHALL not add a plugin-name-specific allowlist

### Requirement: Agent and execution boundaries remain explicit

Sandbox compatibility and inherited plugin loading MUST NOT broaden agent-level
tool permissions or expose alternate code or shell execution to Scout or the
Markdown-only Chat report writer. Scout SHALL remain research/read-only, the
report writer SHALL retain its existing constrained write behavior, and full
coding SHALL require the explicit user-controlled `open in tui` handoff. Native
Context Mode access SHALL remain limited to the exact reviewed worker prefix
specified by the companion Scout contract.

#### Scenario: Plugin loading preserves execution boundaries

- **WHEN** compatibility sandboxing and inherited plugins are enabled
- **THEN** Scout and Write SHALL retain their existing edit, shell, task,
  package, terminal, and unknown-tool denials
- **AND** plugin loading SHALL not create an alternate coding path

#### Scenario: Compatibility does not broaden Scout or report-writer execution

- **WHEN** Chat sandbox compatibility is enabled
- **THEN** Scout SHALL retain research/read-only behavior
- **AND** Scout SHALL be able to delegate only to the exact injected
  `chat-research-worker`
- **AND** Scout SHALL not delegate coding, shell, package, terminal, or
  arbitrary-agent work
- **AND** the delegated worker SHALL retain its read-only tool boundary
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
