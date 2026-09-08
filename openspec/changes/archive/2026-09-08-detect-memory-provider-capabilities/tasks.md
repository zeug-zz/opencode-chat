## 1. Shared status and discovery boundary

- [x] 1.1 Add shared memory-provider state and capability types for sanitized host/UI communication. **Verify:** focused TypeScript typecheck and protocol tests.
- [x] 1.2 Add a provider discovery/probe abstraction with Hindsight detection outcomes for unavailable, configured, available, partial, blocked, and error states. **Verify:** unit tests use fakes and never require credentials or network access.
- [x] 1.3 Implement bounded reason normalization and redaction so statuses cannot expose credentials, raw configuration, private paths, or provider payloads. **Verify:** focused redaction tests and `git diff --check`.

## 2. Extension-host integration

- [x] 2.1 Run memory detection during companion initialization without changing existing agent, MCP, plugin, sandbox, or guidance overlays. **Verify:** extension-host launch tests confirm no configuration writes and unchanged overlay shapes.
- [x] 2.2 Publish typed memory status during webview `ready`, companion reconnect, and launch-policy refresh paths; preserve initialization when detection fails. **Verify:** focused ChatViewProvider/extension tests for all status states.

## 3. Compatibility and documentation

- [x] 3.1 Add regression coverage proving unavailable/blocked/error detection preserves normal Chat and Write operation and ordinary OpenCode context/AGENTS.md fallback. **Verify:** focused extension tests and existing relevant agent tests.
- [x] 3.2 Document that this change detects capabilities only; it does not yet expose memory tools or automatic retention, and no-provider operation remains AGENTS.md/context based. **Verify:** focused documentation audit and `git diff --check`.
- [x] 3.3 Run the focused package tests, Biome checks for touched files, strict OpenSpec validation, and final worktree diff review. **Verify:** all commands pass; do not archive or commit.
