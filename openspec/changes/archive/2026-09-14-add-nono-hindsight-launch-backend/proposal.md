## Why

Scribe currently tries to recreate the Hindsight TUI’s provider filesystem, lifecycle, and operation contract inside its own compatibility sandbox. That duplicates a policy already enforced by nono, leaves full Hindsight unavailable when its native state paths are needed, and has expanded into a broad, unverified parity queue.

This change makes the actual nono boundary the full-Hindsight path while retaining a safe, limited Scribe-sandbox fallback for installations where nono is unavailable.

## What Changes

- Use the built-in `opencode` nono profile whenever supported external nono passes bounded preflight. On first sandbox-enabled use, when custom user profiles are available, offer an optional one-time picker to keep `opencode` or select a custom profile; persist only the chosen profile name.
- Launch the extension-owned `opencode serve` through direct-argv `nono wrap` in the nono backend, without initializing or wrapping it again with `SandboxManager`.
- Allow full approved native Hindsight behavior only in the successful nono backend, including its provider-owned hooks and observed operation surface.
- Keep the no-nono fallback in the existing compatibility sandbox, but expose only exact read-only Hindsight recall operations; reflection, explicit writes, diagnostics, synchronization, and automatic lifecycle retention remain unavailable there.
- Preserve process-scoped overlays, Scout/Build and research-worker restrictions, loopback-only serving, bounded/redacted diagnostics, tree-complete cleanup, and no runtime fallback from a selected nono backend.
- Report the selected backend accurately without treating a nono-backed child as unsandboxed merely because Scribe’s `SandboxManager` is not used.

### Non-goals

- Bundling, installing, configuring, or modifying nono, its profiles, the TUI, or global/workspace OpenCode or Hindsight configuration.
- Trusting or auto-selecting arbitrary custom user nono profiles without an explicit user selection and bounded validation.
- Adding a Hindsight wildcard or broadening shell, edit, task, package, terminal, plugin, or worker authority.
- Recreating TUI lifecycle, retention, or provider-state policy inside the VS Code compatibility sandbox.
- Completing, committing, archiving, or silently discarding the separate uncommitted `complete-hindsight-tui-parity` queue.

### Risks, fallback, and compatibility

Nono and the VS Code compatibility sandbox are separate enforcement implementations. Nono is selected whenever its built-in `opencode` profile, or an explicitly selected validated custom profile, passes preflight; only unavailable or unsupported nono selects the existing sandbox with recall-only Hindsight. Once nono is selected, launch/readiness failure leaves Chat unavailable and must not retry through another backend. The independent TUI remains unchanged. Existing fallback reflection is intentionally removed when nono is unavailable to keep provider hooks and write-capable behavior within the real nono boundary.

## Capabilities

### New Capabilities

- `nono-companion-launch-backend`: Deterministic external nono discovery, preflight, direct-argv companion launch, backend-aware lifecycle, diagnostics, cleanup, and pre-launch fallback selection.

### Modified Capabilities

- `chat-agent-sandbox`: Permit an externally enforced nono backend alongside the existing compatibility sandbox while preserving settings semantics, fail-closed launch behavior, descendant enforcement, loopback access, cleanup, and unchanged Windows support.
- `hindsight-companion-tools`: Gate full approved Hindsight behavior on the nono backend and restrict the compatibility-sandbox fallback to exact read-only recall operations.
- `automatic-session-retention`: Activate native automatic retention only for an approved provider launched through the verified nono backend; make it unavailable and non-mutating in the fallback backend.
- `companion-scoped-scout`: Make Scout/Build Hindsight permissions backend-scoped while retaining all non-Hindsight and research-worker denials.

## Impact

Expected implementation is limited to the VS Code extension-host launch selection, OpenCode-agent launch configuration and child lifecycle, Hindsight integration policy, focused tests, and documentation. It uses an externally installed nono executable; no new package dependency, VSIX-bundled binary, global configuration write, or independent TUI modification is allowed.

Implementation must begin only after the current uncommitted Hindsight queue is explicitly separated, retained, or discarded by the user; this change does not authorize implicit git cleanup.