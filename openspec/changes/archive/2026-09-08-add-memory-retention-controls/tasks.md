## 1. Core retention policy and protocol

- [x] 1.1 Add provider-neutral retention policy/status types and a pure bounded/redaction validator with safe defaults, secret-marker handling, raw-payload exclusion, and deterministic limits. **Verify:** core/agent unit tests cover defaults, invalid values, empty/oversized input, credential redaction, residual-secret rejection, and sanitized reasons.
- [x] 1.2 Extend the typed host/UI protocol for normalized retention settings/status and policy updates without exposing Hindsight tool names, paths, credentials, raw payloads, or provider output. **Verify:** core protocol tests compile and assert the new wire shapes plus backward compatibility of existing memory status messages.

## 2. Workspace settings and status surface

- [x] 2.1 Add workspace-scoped VS Code retention settings with explicit retention disabled, confirmation required, and automatic retention disabled by default; normalize malformed and managed values fail-closed without writing managed settings. **Verify:** extension-host settings tests cover defaults, invalid values, workspace persistence/inspection, and managed-setting behavior.
- [x] 2.2 Wire normalized retention status/settings through activation, ChatViewProvider, and the existing settings panel with localized provider-neutral wording and an evidence-not-instructions warning. **Verify:** extension-host and webview tests cover initial publication, updates, disabled/unavailable/blocked states, and all locale dictionaries.

## 3. Provider adapter and launch overlay

- [x] 3.1 Extend the Hindsight adapter to recognize only the exact retention tool when retain capability and observed inventory agree, and return a separate confirmation-gated permission fragment for Scout and Build while excluding the research worker and all other write/admin tools. **Verify:** adapter and agent overlay tests cover enabled/disabled/capability-mismatch/absent-tool cases and assert exact positive and negative permissions.
- [x] 3.2 Thread the normalized retention policy through unsandboxed and sandboxed launch configuration, reconnect/preflight, and existing Hindsight lifecycle suppression without changing sandbox mode or writing user/TUI configuration. **Verify:** agent and extension tests compare both launch paths, verify `HINDSIGHT_DISABLE_HOOKS=1`, and prove provider failure preserves ordinary Chat/Write behavior.

## 4. Confirmation and retention security

- [x] 4.1 Enforce per-request retention confirmation in the host permission router, prevent an `always` response from bypassing required confirmation, and apply the bounded/redacted payload validator before a provider write is allowed. **Verify:** host/agent tests cover confirm-once, reject, timeout/error, always-clamping, safe payloads, secrets, empty/oversized payloads, and no-success-on-failure behavior.
- [x] 4.2 Add end-to-end-shaped regression coverage proving explicit retention never grants shell, edit, task, package, terminal, deletion, administration, unknown-tool, arbitrary-plugin, or lifecycle-retention access, and that no-provider/blocked-provider paths retain AGENTS.md and normal Chat/Write behavior. **Verify:** focused core, agent, extension, sandbox, and webview suites pass with synthetic providers and no credentials/network.

## 5. Final verification

- [x] 5.1 Run strict OpenSpec validation, focused affected-package tests, Biome checks, build, `git diff --check`, and final scope review; document any pre-existing baseline without changing unrelated work. **Verify:** all applicable commands pass; do not archive, commit, amend, or push.
