## Context

The TUI loads Hindsight through the user's global OpenCode plugin configuration. The companion intentionally uses process-scoped overlays for agent, MCP, and bundled guidance behavior, and must not inherit arbitrary global plugins. This change establishes detection only; later changes will decide how an approved provider is exposed to Chat and Write.

## Design

### Normalized status

Add a shared status type with a stable provider id, display name, state, independent capability flags, and an optional sanitized reason. The state set is `unavailable`, `configured`, `available`, `partial`, `blocked`, and `error`.

The status is informational in this change. It must not grant tools or change agent permissions.

### Provider discovery boundary

Create a small provider-discovery boundary in the agent/host layer rather than coupling the webview to Hindsight. The first implementation recognizes the configured Hindsight integration and performs a read-only, bounded probe. Provider-specific paths, configuration values, credentials, and raw tool responses remain internal.

Detection must distinguish:

- no Hindsight/provider configuration;
- a configured provider whose runtime is unavailable;
- a provider that responds but lacks one or more required operations;
- a provider that cannot be safely used under the current companion policy; and
- unexpected discovery failures.

The implementation must not load or initialize unrelated global plugins merely to detect Hindsight. If the OpenCode runtime cannot expose a safe capability probe without loading arbitrary plugins, report the provider as unavailable/configured/error according to the evidence rather than broadening plugin access.

### Host and webview protocol

Add a typed host-to-webview message for memory status. Publish the status during the existing `ready` initialization path and whenever the companion is reconnected or its launch policy changes. Keep initialization resilient when detection fails.

The webview only needs normalized display data. It must not receive raw plugin paths, API URLs, environment values, credentials, tool payloads, or unbounded exception messages.

### AGENTS.md compatibility

Do not add an alternate prompt loader or redirect the OpenCode configuration root. Normal OpenCode context assembly remains the source of applicable `AGENTS.md` guidance. Detection is optional metadata and must not alter the ordinary request path.

### Testing strategy

Add unit tests for status normalization and redaction, provider discovery outcomes, no-configuration fallback, partial capabilities, blocked policy, and probe errors. Add extension-host tests for initialization and reconnection messages. Add regression coverage confirming launch overlays and MCP behavior are unchanged and no configuration files are written.

Use fakes for the provider probe so tests do not contact Hindsight or require credentials. A live probe is a later verification concern for the completed provider integration, not a test dependency for this detection change.

## Non-goals

- Enabling Hindsight tools for Chat or Write.
- Automatic session retention or host-owned retention.
- Generic provider registry or Supermemory support.
- New sandbox filesystem/network grants.
- Inheriting the user's complete global plugin list.
- Provider configuration UI or writes to OpenCode configuration.
