## Why

The runtime-contract phase records sanitized AF observations and the security prerequisites for execution, but Scribe still has no host-owned way to preflight or run an approved AF operation inside an isolated review root. A later claim-projection change cannot safely build on guessed argv, output, workspace, or cleanup behavior, so the bridge must make those boundaries executable and fail closed before any review result can be projected.

## What Changes

- Add a platform-private, fixture-derived AF operation union for the currently observed compatibility/preflight operations (`version`, `schema`, `init`, and `status`); callers cannot supply shell strings, arbitrary verbs, flags, executable paths, workspaces, or raw argv.
- Add bounded runtime compatibility preflight that resolves a host-controlled `af` executable, validates the supported macOS/Linux platform and pinned runtime identity, checks the observed version/schema contract, and reports unavailable/incompatible rather than guessing.
- Add a proof-workspace store rooted beneath `ExtensionContext.globalStorageUri`, with unique session/review directories, containment and symlink/traversal checks, bounded cleanup, and no repository, home, OpenCode-state, or sibling-root writes.
- Add a dedicated AF process boundary separate from the Chat sandbox. It uses direct argv with `shell: false`, the fixed operation union, bounded input/output, operation-specific timeouts, cancellation and descendant reaping, and an explicit OS policy that denies unapproved children and writes outside the review root.
- Add a host-owned runtime bridge/preflight surface for later claim projection without exposing AF as an OpenCode plugin, MCP server, custom tool, model-visible route, or configuration authority.
- Add opt-in integration coverage for a disposable AF installation/profile and keep default tests fixture-only, bounded, non-networked, and safe when AF or the dedicated policy is absent.

## Capabilities

### New Capabilities

- `vibefeld-runtime-bridge`: Provides a fixture-derived, host-owned AF runtime bridge with compatibility preflight, dedicated proof storage, enforced process boundaries, bounded failure handling, and opt-in integration verification.

### Modified Capabilities

None.

## Impact

- Affected code: private modules under `packages/platforms/vscode/src/vibefeld/`, extension-host wiring needed to construct the bridge, and focused extension-host/integration tests.
- Affected behavior: runtime availability may be reported only after the dedicated bridge preflight succeeds; the existing unavailable/manual-review fallback remains fail-closed until a later claim-projection change supplies review semantics. Ordinary Chat, Write, Scout, worker, MCP, reasoning streaming, companion sandboxing, and the independent TUI remain unchanged.
- Dependencies: no AF package or bundled executable is added. The bridge uses host-resolved runtime facilities and existing platform primitives; any live AF executable, policy/profile, and disposable workspace are explicit external test prerequisites.
- Security: AF remains host-owned and provider-private. Missing policy support, unsupported platforms, identity/fixture mismatch, malformed or oversized output, timeout, cancellation, signal exit, cleanup failure, or audit failure produces unavailable/audit-failed state and never weakens into the active-workspace Chat sandbox or an unsandboxed process.
- Compatibility: default CI and normal activation do not require AF, nono, network access, or user configuration changes. Opt-in integration tests run only with an explicitly selected disposable runtime and project-local test artifacts.
