# Proposal

## Why

OpenCode V2 is now the installed host, but Scribe still uses the legacy `@opencode-ai/sdk/v2` client and has an in-process server launch path alongside a direct nono child path. V2 migration must unify private foreground serving and prove authenticated API compatibility while preserving the current security contract.

## What Changes

- Replace the old client/server integration with a V2-only `@opencode/client` adapter and an authenticated, private, foreground loopback `opencode serve` child for every supported backend.
- Express Scribe's restrictions and overlays in native V2 form in memory only; preserve supported user configuration source formats and never persist Scribe policy through config APIs.
- Preserve sessions, forms, attachments, streaming, queues, reconnect, model/effort selection, TUI handoff outcomes, and currently enabled AF and Hindsight behavior. Rework the 0.18.0 AF/Vibefeld reasoning path around an ephemeral, private-server plugin brief, background assessment, on-demand restricted reviewers, and manual completed-answer review as a secondary message action, not a prominent primary button on every answer. Remove dedicated review-result and thinking Markdown copy controls while preserving main-answer copy; the durable instruction-channel acceptance is superseded for this brief.
- Require native V2 Code Mode for research composition: explicit native `execute` for Scout, the reviewed research worker, and otherwise-permitted Build-backed Write; native MCP Code Mode defaults and native `fetch` are accepted without Scribe-specific interpreter/network limits. Shell, arbitrary delegation, editing outside Write's existing scope, and unapproved tools remain denied.
- Replace the unsafe restricted-server TUI attach fallback with independent V2 import or an explicit unavailable result. Resolve MCP preference semantics without bypassing enforced higher-authority denials.
- Retain bounded contract, mock-provider, inherited-plugin, actual-host/sandbox, full-suite, packaging, recovery, limitation, and agreed soak qualification criteria. By user direction on 2026-10-30, the formal isolated-host/live/soak programme is stopped; outstanding required live gates are deferred and unverified, not passed or waived.

## Capabilities

### New Capabilities
- `opencode-v2-adapter`: Owns the V2 protocol boundary, private child identity/auth/location, explicit mappings, reconnect, and honest capability outcomes. A dedicated wire-boundary capability prevents transport details entering core/VS Code layers.

### Modified Capabilities
- `nono-companion-launch-backend`: Unify the SDK-managed and existing direct-nono `serve` launch paths as private foreground V2 child launches, with V2 authentication, version, workspace, and injection behavior proven for each backend.
- `chat-agent-sandbox`: Effective V2 policy and inherited discovery must be proven without treating configuration intent as enforcement.
- `companion-plugin-runtime`: Preserve native inherited plugin loading and the narrowly eligible fallback under V2 discovery/removal semantics.
- `companion-scoped-scout`: Preserve Scout/worker/Write boundaries through native V2 overlays and inherited policy.
- `chat-mcp-settings`: Resolve preference selection, complete transport definitions, suppress unselected local starts, and preserve higher-authority denials.
- `session-tui-handoff`: Remove required attach fallback to the restricted server; independently import or report unavailable.
- `model-effort-control`: Preserve server-default omission and explicit effort on V2 prompt delivery.
- `vibefeld-reasoning-assist`: Deliver an argument brief ephemerally to outgoing Scout model calls through a verified Scribe-owned V2 plugin; keep ordinary prompts unchanged and run assessment off the admission path.
- `vibefeld-adversarial-review`: Add exact, tool-less on-demand Scout reviewer agents and a typed manual Review argument action without an answer gate or model-visible AF route.
- `hindsight-companion-tools`: Preserve the existing plugin-managed daemon/injection/loopback/database/lifecycle boundary while qualifying V2 plugin operations.
- `vibefeld-runtime-bridge`: Reconcile historical dedicated-AF-policy language with the canonical and user-authorized host-owned direct-execution boundary; AF remains a bounded direct child under any enclosing sandbox, without a second AF policy layer.

This changes existing agent, MCP, adapter, and Vibefeld requirements only; it introduces no new capability.

## Impact

Primary paths: `packages/agents/opencode/**`, `packages/core/src/protocol.ts`, `packages/platforms/vscode/src/{extension.ts,chat-view-provider.ts,vscode-platform-services.ts}`, the bundled Scribe plugin and webview/locales, and focused agent/extension-host/webview tests. No synced specs, user configuration, shared service, external plugin source, AF runtime, profile, installation, or deployment changes. Platform migration completion is context only; historical coexistence gates are excluded.

Compatibility impact: Current V1-shaped adapter and `@opencode-ai/sdk/v2` are removed, not retained as fallback. Until each required operation and installed integration is evidenced, release acceptance stays blocked. The user-approved stop of the formal host programme defers the remaining live evidence; it does not satisfy or waive those gates. Recovery is a previously proven V2-compatible Scribe build if one exists; otherwise disable/uninstall the candidate and use independent V2 TUI. Do not treat this current adapter as a rollback.

## Non-Goals

- V1 coexistence or fallback, `opencode2`, binary installation/link changes, shared-service adoption, or embedded server SDK.
- Rewriting user OpenCode, Hindsight, or nono configuration; changing profiles; or adding nested nono.
- External plugin ports/edits, AF upgrade/redesign, dormant Vibefeld activation, unrelated UI redesign, install/deployment, commit, or push.
