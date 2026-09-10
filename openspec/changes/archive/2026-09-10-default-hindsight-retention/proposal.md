## Why

The companion already enables automatic Hindsight lifecycle retention by
default, but explicit retention remains hidden behind a separate workspace
setting and the Chat settings panel exposes several retention controls that add
clutter without matching the intended installed-provider experience. A user who
has installed and configured the approved Hindsight provider should receive the
capability by default, while explicit durable writes must continue to require
confirmation and all existing provider, payload, and sandbox gates.

## What Changes

- Resolve a fixed provider-neutral retention policy of explicit retention
  enabled, confirmation required, and automatic session retention enabled.
- Treat an installed exact approved Hindsight provider as opt-in at the provider
  installation/configuration boundary rather than requiring a second extension
  setting.
- Ignore legacy workspace retention disable values after this change; do not
  rewrite those settings.
- Remove the retention checkboxes and retention status section from the Chat
  settings panel.
- Remove the obsolete VS Code retention setting contributions and webview policy
  update path while retaining the host-side confirmation and provider gates.
- Keep the exact observed Hindsight retention tool, bounded/redacted payload
  validation, per-request confirmation, and exclusion from the research worker.
- Keep automatic retention bounded, capability-gated, sandbox-aware, and
  nonfatal when Hindsight is unavailable or unsafe.
- Preserve the no-provider/AGENTS.md fallback and independent OpenCode TUI
  behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-retention-controls`: Replace persisted opt-in controls with an
  always-on provider-gated policy and remove the interactive settings surface.
- `automatic-session-retention`: Remove workspace disablement and make the
  already-enabled default unconditional once the approved provider passes its
  capability and sandbox checks.
- `hindsight-companion-tools`: Make exact explicit retention available by
  default without weakening exact-tool or confirmation gates.
- `companion-scoped-scout`: Make the exact retention exception independent of a
  user setting while preserving Scout/Write/worker boundaries.

## Impact

- `packages/core/src/domain.ts` and the retention protocol types: change the
  effective policy defaults and remove UI-only policy mutation messages where no
  longer needed.
- `packages/platforms/vscode/src/memory-retention-settings.ts` and
  `packages/platforms/vscode/src/extension.ts`: replace workspace policy loading
  and updates with the fixed provider-gated policy.
- `packages/platforms/vscode/src/chat-view-provider.ts`: retain the exact
  confirmation and payload validation path without a settings update handler.
- `packages/platforms/vscode/webview/` and locale dictionaries: remove the
  retention settings/status section, props, messages, and unused strings.
- `packages/platforms/vscode/package.json`: remove obsolete retention settings
  contributions.
- Hindsight, launch-parity, security, and UI tests/specifications: update
  defaults, fallback, and no-settings-surface expectations.

## Scope and Non-goals

- This change does not grant Hindsight deletion, administration, diagnostics,
  synchronization, or unknown tools.
- It does not remove per-request confirmation for explicit durable writes.
- It does not make retrieved memory trusted instructions or expose provider
  paths, credentials, raw payloads, or unbounded diagnostics.
- It does not write or migrate existing VS Code workspace settings.
- It does not change independent OpenCode TUI retention behavior.
- It does not make retention available when the exact provider identity,
  capability, observed tool inventory, lifecycle contract, or sandbox policy
  fails.

## Risks, Fallback, and Compatibility

The main behavior change is that a verified provider may write bounded automatic
session summaries and may offer explicit retention without an extension setting
toggle. Automatic writes remain limited to provider-approved summaries and exact
lifecycle checks. Explicit writes remain confirmation-gated for every request.

Legacy workspace disable values are intentionally ignored, as the new policy is
always-on by design. If Hindsight is missing, incompatible, blocked, or fails,
the companion keeps ordinary Chat/Write behavior and the AGENTS.md fallback; it
does not weaken the sandbox or retry unsandboxed. The settings panel becomes
smaller, while retention policy/status remains host-side for enforcement and
bounded diagnostics rather than user-configurable UI.
