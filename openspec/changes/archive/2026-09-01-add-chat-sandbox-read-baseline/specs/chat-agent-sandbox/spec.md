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

When the effective platform sandbox is macOS or Linux, the policy SHALL also
apply a static read-deny baseline to the companion and its descendants. The
cross-platform baseline SHALL deny these paths relative to the effective home
directory: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.config/gcloud`, `.gcloud`,
`.kube`, `.docker`, `.git-credentials`, `.netrc`, `.npmrc`, `.bunfig.toml`,
`.config/bun/bunfig.toml`, `.vault-token`, `.credentials`, `.secrets`, `.keys`,
`.pki`, `.terraform.d`, `.config/op`, `.bash_history`, `.zsh_history`,
`.history`, `.python_history`, `.zshrc`, `.zprofile`, `.zshenv`, `.zlogin`,
`.zlogout`, `.bashrc`, `.bash_profile`, `.bash_login`, `.bash_logout`,
`.profile`, `.config/fish`, `.env`, and `.envrc`.

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
`~/Library/Application Support/MobileSync`.

On Linux, the baseline SHALL additionally deny `~/.password-store`,
`~/.1password`, `~/.op`, `~/.local/share/keyrings`,
`~/.config/google-chrome`, `~/.config/chromium`, `~/.mozilla/firefox`,
`~/.config/microsoft-edge`, `~/.config/BraveSoftware`,
`~/.config/vivaldi`, and `~/.config/opera`.

The baseline SHALL be derived from the effective home directory, normalized,
deduplicated, and applied deterministically. It SHALL not require nono to be
installed or inspect user-specific nono profiles. Required workspace,
executable, OpenCode, cache, and temporary read grants SHALL not overlap a
protected deny path; if such an overlap exists, policy construction SHALL
fail before launch with an actionable error rather than re-allowing the
protected path. Unsupported platforms, including Windows, SHALL not claim
that this baseline is enforced.

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
- **AND** macOS-only paths SHALL not be emitted on Linux
- **AND** Linux-only paths SHALL not be emitted on macOS
- **AND** the deny paths SHALL be resolved from the configured home directory

#### Scenario: Deny and required grants cannot overlap

- **WHEN** the active workspace or a required executable, OpenCode, cache, or
  temporary path is within or contains a protected deny path
- **THEN** filesystem policy construction SHALL fail before the companion starts
- **AND** the failure SHALL identify the conflicting policy boundary
- **AND** the extension SHALL not replace the conflict with a broad home grant

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
