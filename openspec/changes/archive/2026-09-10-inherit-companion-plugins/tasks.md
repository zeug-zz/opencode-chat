## 1. Native Plugin Source Model

- [x] 1.1 Trace the supported OpenCode server version's global/project config
  merge, `OPENCODE_CONFIG_CONTENT` behavior, and global/project plugin-directory
  discovery in both SDK-managed and child-process launches. **Verify:** a
  focused fixture identifies which native sources are preserved without
  executing plugin code.
- [x] 1.2 Extend the launch configuration to carry inherited plugin sources
  without copying unrelated OpenCode configuration. Preserve configured npm,
  local-path, file-URL, and tuple entries as opaque values and retain native
  plugin-directory discovery. **Verify:** overlay serialization contains only
  the intended plugin sources and does not log or expose plugin options.
- [x] 1.3 Compose the inherited plugin list with the approved Hindsight
  integration without replacing or duplicating unrelated plugin entries.
  **Verify:** Hindsight capability detection still receives the exact approved
  identity while the launch overlay preserves all configured plugin sources.

## 2. Launch Parity and Failure Handling

- [x] 2.1 Apply the same plugin source configuration to SDK-managed and
  sandboxed companion launches. **Verify:** launch-parity tests compare plugin
  sources, agent permissions, MCP overlay, guidance overlay, workspace, and
  network policy.
- [x] 2.2 Add a bounded plugin-free startup fallback that retries at most once
  after plugin activation or readiness failure, retains the requested sandbox
  mode, and never retries unsandboxed. **Verify:** plugin failure starts a
  plugin-free companion when possible, and fallback failure preserves existing
  startup diagnostics.
- [x] 2.3 Ensure runtime plugin-hook/tool failures remain bounded operation
  failures and do not trigger broad filesystem/network access or an automatic
  unsandboxed restart. **Verify:** simulated post-readiness plugin errors do
  not cause repeated reconnects or policy changes.
- [x] 2.4 Preserve independent TUI configuration and process ownership.
  **Verify:** no global/project config file writes occur and an independent TUI
  process retains its normal plugin and agent configuration.

## 3. Sandbox Compatibility

- [x] 3.1 Reuse the existing compatibility filesystem policy for inherited
  plugin source/dependency reads and existing OpenCode/runtime/temp writes; do
  not add plugin-name-specific read or write grants. **Verify:** policy tests
  allow non-protected plugin reads, deny unsupported outside writes, and retain
  protected credential-path denials.
- [x] 3.2 Verify native plugin runtime state and temporary children use the
  existing generic runtime/cache/temp policy. **Verify:** Context Mode and a
  representative future-plugin-shaped runtime can start when using supported
  paths, while unsupported writes fail without broadening the policy.
 - [x] 3.3 Preserve one companion-wide network policy for OpenCode, plugins,
  MCPs, providers, and descendants. **Verify:** network-on/off tests remain
  unchanged for both plugin and MCP child behavior.

## 4. Agent and Provider Boundaries

- [x] 4.1 Preserve Scout, Build-backed Write, and research-worker negative
  permissions while loading plugins. **Verify:** edit, bash, shell, task,
  package, terminal, deletion, administration, wildcard, and unknown-tool
  denials remain asserted.
- [x] 4.2 Add the native Context Mode `ctx_*` prefix to the exact read-only
  worker allowlist while retaining `context-mode_*` for the MCP server and
  denying generic plugin wildcards. **Verify:** native and MCP Context Mode
  tools are available only to the intended worker boundary.
- [x] 4.3 Preserve exact Hindsight identity, observed-inventory, capability,
  lifecycle, retention, and untrusted-evidence checks independently from
  general plugin loading. **Verify:** unrelated plugins cannot expose Hindsight
  administration, deletion, synchronization, or unknown tools.

## 5. Diagnostics and Documentation

- [x] 5.1 Extend bounded/redacted startup and sandbox diagnostics to identify a
  plugin-loading failure without exposing plugin options, credentials, raw
  configuration, or unbounded output. **Verify:** diagnostic tests cover
  truncation and redaction.
- [x] 5.2 Update root and extension documentation to explain inherited native
  plugins, compatibility-sandbox behavior, in-process plugin trust, constrained
  writes, and the plugin-free fallback.
- [x] 5.3 Synchronize `companion-scoped-scout`, `chat-agent-sandbox`, and
  `hindsight-companion-tools` main specs after implementation and verification.

## 6. Verification

- [x] 6.1 Run focused agent, extension-host, sandbox, and integration tests for
  configured and auto-discovered plugin sources, Context Mode native/MCP tools,
  fallback startup, and launch parity.
- [x] 6.2 Run `pnpm run check`, `pnpm run build`, `git diff --check`, and strict
  OpenSpec validation.
- [x] 6.3 Perform a final scope review confirming no configuration writes,
  unsandboxed plugin fallback, generic worker plugin wildcard, or broad sandbox
  write grant was introduced.
