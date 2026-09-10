## Context

The companion currently launches OpenCode with an in-memory agent/MCP/guidance
overlay. The overlay deliberately omits the user's plugin list, and the
Hindsight integration is the only controlled plugin exception. This makes the
companion differ from the normal OpenCode runtime and prevents native plugin
integrations such as Context Mode from initializing.

The existing Chat sandbox is compatibility-oriented: reads outside its
protected deny-read baseline are broadly available, while writes are limited to
the workspace and derived OpenCode/runtime/temp paths. MCPs already rely on that
generic process policy rather than server-specific package grants. Plugins can
use the same policy, but unlike MCPs they execute in the OpenCode server
process, so the trust model must be explicit.

## Goals / Non-goals

**Goals:**

- Preserve OpenCode's native configured and auto-discovered plugin sources for
  the companion-owned server.
- Make SDK-managed and sandboxed launches expose the same plugin surface.
- Keep the current agent-level Scout/Write/research-worker boundaries.
- Keep the sandbox generic, with no per-plugin read allowlist or home-root write
  grant.
- Make a plugin that cannot start nonfatal when a plugin-free companion can
  start.
- Keep Hindsight's exact capability and retention controls independent from
  general plugin inheritance.

**Non-goals:**

- Copying the entire global/project OpenCode configuration.
- Allowing arbitrary plugin tools to the research worker through a wildcard.
- Isolating in-process plugin hooks from the OpenCode server process.
- Adding plugin installation, removal, version management, or UI controls.
- Making sandboxed plugin failures retry outside the sandbox.

## Decisions

### 1. Preserve native plugin discovery rather than implementing a package resolver

The companion should use OpenCode's own plugin loading and discovery semantics.
Configured global/project plugin entries, tuple options, and supported global or
project plugin directories should remain opaque to the extension. The extension
must not import or execute plugin code merely to determine whether it is safe.

The implementation will first verify how the installed OpenCode server merges
`createOpencodeServer` configuration and `OPENCODE_CONFIG_CONTENT` with native
plugin sources. If the SDK-managed path does not retain native plugin sources
when an in-memory config is supplied, the launch configuration will carry the
effective configured entries as an opaque `plugin` overlay while leaving native
directory discovery enabled. The implementation must not create a second
plugin-resolution system for package names or local module paths.

Arrays and tuple options must be preserved deliberately because plugin arrays
replace rather than deep-merge in some OpenCode config layers. The overlay
composition must avoid silently dropping global or project entries and must
deduplicate only when the OpenCode runtime itself defines the duplicate rule.

### 2. Separate inherited plugin loading from Hindsight capability detection

The inherited plugin source is part of the normal companion launch configuration.
Hindsight resolution remains a non-executing identity check used only to derive
provider status, exact tool permissions, lifecycle environment, and retention
capability. Hindsight must no longer replace the complete plugin list in the
overlay.

When Hindsight is not verified or its lifecycle integration is not active, the
existing suppression environment remains in force. Loading a plugin does not
automatically grant its tools to Scout, Write, or the research worker.

### 3. Preserve the agent permission boundary

The existing Scout and Build overlay remains the source of truth for built-in
edit, shell, task, package, terminal, deletion, administration, and unknown-tool
permissions. Inherited plugin loading alone must not modify those maps.

The read-only research worker receives the exact native Context Mode prefix
(`ctx_*`) in addition to the existing reviewed MCP prefix (`context-mode_*`). It
does not receive a generic plugin wildcard. The worker continues to deny edit,
bash, task recursion, package operations, terminal control, and unknown tools.

### 4. Reuse compatibility sandbox semantics

No per-plugin package root or executable path is added to the filesystem policy.
The existing compatibility read behavior permits plugin source and dependency
reads outside protected deny paths. Existing OpenCode state/cache/temp and
runtime-cache grants remain the only generic write grants. A plugin requiring an
additional write path is allowed to fail rather than causing an automatic path
expansion.

The sandbox policy applies to the OpenCode server and its descendants as it does
for MCPs. Network behavior remains controlled by the one companion-wide network
policy. Independent TUI processes remain outside this boundary.

### 5. Use one bounded plugin-free startup retry

The plugin-enabled configuration is attempted first. If the server fails before
readiness because inherited plugin activation prevents startup, the extension
stops the failed companion and retries once with an explicit empty plugin list.
The retry keeps the requested sandbox mode, network policy, agent overlay, MCP
overlay, guidance overlay, and workspace. It must not remove protected denies or
retry unsandboxed.

If the plugin-free retry also fails, existing startup error handling applies. A
successful fallback reports a bounded, redacted plugin-unavailable diagnostic;
it does not expose plugin options, credentials, or raw configuration content.

Errors from a plugin hook or plugin tool after readiness remain ordinary
operation failures. This change does not attempt to restart the server for every
runtime plugin exception because hooks execute in-process and the runtime cannot
reliably identify an isolated plugin boundary.

### 6. Keep configuration ownership and diagnostics safe

The extension never writes global or workspace OpenCode configuration as part of
plugin inheritance. Plugin entries may contain user-supplied options, so launch
payloads and diagnostics must not log raw configuration or environment values.
Existing bounded redaction applies to startup output and sandbox violations.

User-facing documentation must state that enabling the compatibility sandbox
does not make in-process plugins untrusted or strongly confidential; users
should install only plugins they trust.

## Risks / Trade-offs

- **In-process plugin trust:** A plugin can register hooks and inspect or mutate
  OpenCode lifecycle data. This is accepted as the consequence of matching the
  native OpenCode plugin model and must be documented.
- **Plugin-specific writes:** A future plugin may need a write directory not
  covered by the generic policy. It may fail in sandboxed mode; the companion
  falls back to a plugin-free launch rather than broadening writes.
- **Config-version differences:** SDK-managed and child-process config loading
  may differ across OpenCode versions. Parity tests must use the supported
  server version and fail if plugin sources are silently dropped.
- **Context Mode tool naming:** Native plugin tools and MCP tools use different
  prefixes. Both exact prefixes need coverage without introducing a wildcard.
- **Startup fallback visibility:** The fallback keeps Chat usable but means a
  user may need diagnostics to understand why a plugin is absent. Diagnostics
  remain bounded and provider-neutral.

## Migration Plan

No configuration migration or file write is required. On the next companion
restart, configured and auto-discovered plugins are loaded by the companion. A
plugin that cannot start under the current sandbox receives one plugin-free
fallback attempt. Users can continue using the independent TUI with its normal
configuration.

## Verification Commitments

Verification must cover configured npm, tuple, absolute-path, global-directory,
and project-directory plugin sources where supported by the installed OpenCode
runtime; SDK-managed and sandboxed overlay parity; Context Mode native and MCP
tool prefixes; Scout/Build/worker negative permissions; protected-read and
constrained-write behavior; one bounded plugin-free retry; no unsandboxed retry;
redacted diagnostics; no configuration writes; and independent TUI isolation.
