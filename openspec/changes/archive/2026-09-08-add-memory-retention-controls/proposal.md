## Why

The companion now has capability-gated Hindsight recall and reflection, but it still cannot safely honor an explicit user request to remember a bounded finding. Enabling a durable external write without persisted workspace controls, confirmation, and host-side data policy would let model-generated content cross the memory boundary without sufficient consent. This change adds an opt-in retention path while keeping automatic lifecycle retention disabled by default and preserving the no-provider/AGENTS.md fallback.

## What Changes

- Add a provider-neutral, workspace-scoped retention policy with safe defaults: explicit retention disabled until enabled, confirmation required, automatic session retention disabled, and no deletion or provider administration.
- Persist and sanitize the retention policy through the VS Code workspace settings boundary; invalid or managed values fail closed.
- Extend the approved Hindsight adapter with the exact retention operation only when the detected provider advertises `retain`, the exact tool is present, and the user has enabled explicit retention.
- Configure the retention tool as confirmation-gated rather than an unconditional allow; prevent a permission response from permanently bypassing confirmation when confirmation is required.
- Add bounded retention guidance and host-side payload policy for user-approved summaries: redact credential/secret material, reject empty or oversized content, and exclude raw tool payloads and unrelated private content by default.
- Surface sanitized retention settings/status in the existing settings/status protocol without exposing provider paths, credentials, raw payloads, or provider output.
- Preserve `HINDSIGHT_DISABLE_HOOKS=1`; this change does not enable automatic transcript/session retention, deletion, configuration writes, or arbitrary Hindsight tools.

## Capabilities

### New Capabilities

- `memory-retention-controls`: Workspace-scoped, confirmation-gated explicit memory retention with bounded/redacted payload policy and automatic-retention-off defaults.

### Modified Capabilities

- `companion-scoped-scout`: Permit the exact Hindsight retention operation only through the new opt-in confirmation policy while preserving Scout/Build denial of shell, edit, task, package, terminal, administration, deletion, and unknown tools.

## Scope and Non-goals

This change covers retention policy types, workspace persistence, settings/status wiring, exact Hindsight retention gating, permission confirmation behavior, bounded/redacted retention payload validation, and focused security tests. It does not add provider deletion or administration, inherit arbitrary plugins, write OpenCode/provider configuration, enable automatic session retention or lifecycle hooks, introduce a generic provider registry, or replace AGENTS.md with durable memory.

## Risks, Fallback, and Compatibility

The main risks are accidental durable writes, confirmation bypass, secret leakage, and widening the existing Write/Scout tool boundary. The default-deny policy, exact capability and tool checks, forced confirmation, bounded/redacted payload validator, and negative permission tests mitigate them. If settings are invalid, the provider lacks retain capability, the retention tool is absent, or the provider is unavailable/blocked, explicit retention remains unavailable while recall/reflect and ordinary Chat/Write behavior continue. Existing users receive no retention behavior unless they opt in; the independent TUI configuration and existing AGENTS.md fallback remain unchanged.

## Impact

Affected areas include `packages/core` retention types and protocol messages, the OpenCode Hindsight adapter/launch overlay, VS Code workspace settings and host permission routing, the existing settings panel/status surface, localized strings, and focused core/agent/extension/webview security tests. No new dependency or migration is required; existing worktree memory changes remain in place and are not reverted.
