## Why

The macOS/Linux Chat sandbox already blocks broad classes of credentials,
browser data, and shell configuration, but sensitive leaf files can remain
readable when they are stored outside those existing protected roots. A
conservative, reviewed expansion is needed now to reduce accidental exposure
of high-value sensitive data without converting the compatibility sandbox into
a strict home-directory read allowlist.

## What Changes

- Expand the existing static, versioned macOS/Linux `denyRead` baseline with
  narrow sensitive-data leaf paths selected through review rather than broad
  parent-directory denies.
- Preserve the current normalized, deduplicated, deterministic path
  derivation and the existing fail-closed overlap validation for all required
  read grants.
- Preserve broad reads outside the protected baseline for workspaces,
  OpenCode state/configuration/cache, npm/UV and other runtime caches,
  executable/PATH dependencies, temporary paths, and local MCP runtimes where
  paths do not intentionally enter the protected baseline.
- Preserve the existing sandbox process-tree, network, MCP startup, write
  containment, lifecycle, diagnostics, and no-unsandboxed-fallback behavior.
- Keep Windows unsupported and unchanged: it must not receive new deny paths
  or an enforcement claim.
- Document that MCPs intentionally reading newly protected paths may be
  affected, while core Chat and Write workspace functionality remains intact.
- Do not add a `reports/` directory convention, a host-mediated or staging
  writer, exact report-path enforcement, MCP-specific allowlists, or any
  change to Build's broad workspace-scoped `edit: "allow"` capability. Write
  remains a behavioral requested-artifact workflow, not a technical
  report-only edit boundary; documentation must not claim otherwise.

### Scope

This change covers only the extension-owned companion sandbox policy and its
macOS/Linux protected-read contract, including the corresponding focused
specification, implementation, tests, and accurate security documentation in
later artifacts. The expansion is limited to reviewed sensitive-data leaf
paths and must not alter unrelated compatibility grants or agent boundaries.

### Non-Goals

- No strict whole-home read allowlist or general confidentiality guarantee.
- No Windows sandbox backend, Windows deny baseline, or Windows behavior
  change.
- No runtime nono installation, profile discovery, profile parsing, or
  nono-dependent policy generation.
- No reports directory convention, writer proxy/staging layer, exact report
  path enforcement, or report-only technical edit boundary.
- No MCP-name-specific filesystem exceptions or allowlists, network-domain
  rules, or startup policy changes.
- No change to Build's broad workspace-scoped `edit: "allow"` capability,
  Scout/Write agent permissions, independent TUI behavior, or the existing
  network policy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-agent-sandbox`: Expand the existing macOS/Linux static protected-read
  baseline with reviewed narrow sensitive-data leaf paths while preserving
  compatibility reads and writes, required-grant overlap failure, MCP/process
  inheritance, network behavior, and unsupported Windows semantics.

## Impact

The primary implementation impact is the static deny-path construction in
`packages/platforms/vscode/src/chat-sandbox-policy.ts`, plus focused policy and
launch coverage and the `chat-agent-sandbox` delta specification. Security
documentation will need to describe the expanded baseline and its limits;
the MCP settings capability remains unchanged, although a configured MCP that
intentionally reads a newly protected leaf path may fail or need user action.
No protocol, dependency, configuration-setting, OpenCode state layout, MCP
inventory, or independent TUI change is required.

## Risks and Fallback

The main risk is compatibility loss for a local MCP or runtime that
legitimately reads one of the newly protected leaf paths, along with static
list drift as tools and operating systems evolve. Keep the expansion narrow,
reviewed, deterministic, and tested; surface existing actionable failures and
never broaden access automatically. If a required grant overlaps a protected
path, retain the existing fail-closed pre-launch error rather than removing a
deny or adding a broad parent grant. Users can explicitly select Chat sandbox
`off` to restore the existing unsandboxed compatibility path; this does not
change Windows, which remains unsupported.

## Compatibility Impact

On supported macOS/Linux sandbox launches, reads of the newly protected leaf
paths will be denied for the companion and its descendants, including local
MCP children. Reads and writes for the active workspace, OpenCode state and
configuration, npm/UV/runtime caches, executable/PATH dependencies, temporary
paths, network behavior, MCP startup outside the protected baseline, and the
existing process/lifecycle boundaries remain unchanged. Core Chat and Write
workspace workflows remain available, and Write's requested-artifact behavior
does not become a technical report-only edit restriction. Windows remains
unchanged and unsandboxed with no read-deny enforcement claim.
