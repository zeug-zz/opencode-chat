## Why

The OpenCode TUI can expose Hindsight retain, recall, and reflect capabilities through its configured plugin, but the opencode-chat companion has no reliable way to know whether those capabilities are available. Chat and Write therefore cannot distinguish an unavailable provider from a configured provider that is blocked or only partially capable. Detection must come first so later memory-tool changes can be capability-based, fail safely, and preserve the AGENTS.md-only fallback.

## What Changes

- Add a sanitized host-side memory-provider detection result with explicit provider state and retain/recall/reflect capability flags.
- Detect the configured TUI Hindsight integration through safe configuration/runtime checks without mutating OpenCode configuration.
- Add a companion-to-webview status message for memory-provider availability.
- Keep detection nonfatal: Chat and Write continue to operate when no provider is available or detection fails.
- Do not enable memory tools, automatic retention, plugin inheritance, or provider configuration in this change.

## Capabilities

### New Capabilities

- `memory-provider-detection`: Detect and report whether a configured memory provider, initially Hindsight, is available and which core capabilities it exposes.

### Modified Capabilities

None.

## Impact

- Affected extension-host startup and status plumbing in `packages/platforms/vscode`.
- Affected shared protocol/domain types for sanitized memory status.
- Affected OpenCode-agent/provider discovery code, without changing Chat or Write tool permissions.
- Requires focused unit tests for available, unavailable, partial, blocked, and error states.
- No new dependency, configuration-file write, agent permission, sandbox grant, or persistent memory behavior is introduced.
