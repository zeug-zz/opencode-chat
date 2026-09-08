## 1. Provider-neutral policy and status contract

- [X] 1.1 Change the core automatic-retention policy and provider capability/status shapes from hard-disabled to an independent boolean/capability, add provider-neutral active/disabled/unavailable/blocked/error reporting as needed, and update safe defaults/fixtures without exposing Hindsight internals. **Verify:** core protocol/domain tests prove explicit retention remains separate, no-provider defaults are safe, and automatic capability/status serialization is bounded.
- [X] 1.2 Update agent and VS Code retention-policy normalization, workspace settings, package configuration, and settings updates so automatic retention defaults to enabled, explicit false disables it, malformed values fail closed, managed settings are never overwritten, and explicit retention remains disabled/confirmation-gated by default. **Verify:** focused policy/settings tests cover absent, true, false, malformed, and managed values.

## 2. Hindsight lifecycle integration and launch parity

- [X] 2.1 Extend the approved Hindsight integration to report lifecycle-retention capability and choose a process-scoped suppression environment only when automatic retention is inactive; preserve exact plugin/tool/path gates, explicit retention permissions, recall/reflect allowlists, and the independent TUI. **Verify:** integration tests cover active, disabled, unavailable, blocked, error, partial, and no-provider states without wildcard tools or raw provider data.
- [X] 2.2 Update SDK-managed and sandboxed OpenCode launches to remove the suppression variable only for an active verified automatic-retention integration and set it explicitly for inactive/fallback paths, restoring the parent environment and preserving sandbox/network/MCP/guidance overlays. **Verify:** launch-parity and environment-isolation tests prove active/inactive behavior and no unsandboxed retry.

## 3. Host lifecycle wiring and user-visible state

- [X] 3.1 Wire initial activation, post-inventory reconnect, sandbox changes, provider failures, and retention-setting changes to recompute automatic-retention state without blocking Chat/Write or initializing a provider on no-provider/disabled paths. **Verify:** extension-host tests cover default active policy, explicit disablement, provider failure, reconnect fallback, and unchanged TUI configuration.
- [X] 3.2 Update the existing settings/status surface and all locale dictionaries to distinguish automatic retention from explicit confirmation-gated retention, explain the durable-write default and disable control, and preserve the evidence/untrusted-content warning. **Verify:** webview scenario/component tests and locale-key checks pass.
- [X] 3.3 Add maintained documentation and system-guidance updates describing automatic retention as provider-gated, bounded, active by default only for an approved provider, disableable by workspace policy, and unavailable in the AGENTS.md-only fallback; do not claim AGENTS.md writes or expose provider internals. **Verify:** prompt/security assertions and documentation audit pass.

## 4. Validation and release readiness

- [X] 4.1 Run focused core/agent/extension/webview tests, Biome, `pnpm run build`, strict OpenSpec validation, and `git diff --check`; verify automatic retention does not widen shell/edit/task/package/terminal/provider-admin permissions or alter the independent TUI. **Verify:** all applicable commands pass and the final diff is scoped.
- [X] 4.2 Add a disposable-provider live-verification checklist/test harness for Chat and Write recall, bounded later-session retention, reflect, denied operations, disablement fallback, and sandbox parity; if Hindsight credentials/service are unavailable, report the live gate as blocked rather than claiming operational success. **Verify:** synthetic readiness tests pass and live status is explicitly recorded.
