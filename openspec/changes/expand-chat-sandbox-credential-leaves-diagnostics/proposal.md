## Why

The 2026-09-03 jailbreak report showed that the compatibility sandbox still permits reads of several high-value credential stores, including an Electrum wallet, an Android private key, and Claude configuration data. The existing sandbox diagnostics preserve useful redacted output for user-visible MCP failures, but the extension host does not consistently record the underlying sandbox denial reason for later diagnosis. This follow-up closes only those high-confidence gaps while preserving the compatibility-first Chat and Write workflows.

## What Changes

- Expand the supported macOS/Linux static protected-read baseline with narrow, reviewed credential leaves observed or identified in the report:
  - `.claude.json` and `.claude/.credentials.json`;
  - `.codex/auth.json` and `.gemini/oauth_creds.json`;
  - `.electrum`;
  - `.android/adbkey` and `.android/adbkey.pub`.
- Keep the protected entries home-relative, normalized, deduplicated, deterministic, platform-separated, and subject to the existing fail-closed deny/grant overlap validation.
- Preserve the companion's required OpenCode configuration and authentication reads; do not deny the OpenCode config root or its provider-auth path required for Chat operation.
- Add bounded, redacted extension-host logging for sandbox startup/readiness failures, unexpected companion exits, and failed MCP operations. When the runtime exposes an OS denial reason, the log and existing user-visible diagnostic SHALL preserve that reason together with operation/stage context without logging secret payloads.
- Preserve existing user-visible diagnostic formatting, MCP transport attribution, violation limits, process inheritance, network policy, write containment, no-unsandboxed-fallback behavior, and unsupported Windows behavior.
- Update focused tests and security documentation to describe the additional leaves, the host-side diagnostic logging, and the remaining compatibility-sandbox limitations.

### Scope

This change covers only the extension-owned companion sandbox's reviewed credential-leaf baseline and diagnostics emitted by the extension-host/agent launch path, plus their focused tests and accurate security documentation. It does not change agent permissions, the webview/host protocol, MCP-specific policy, network rules, or the broad workspace-scoped Write behavior.

### Non-Goals

- No strict whole-home read allowlist, broad home/Library/XDG/Volumes deny, other-user-home isolation, or general confidentiality guarantee.
- No runtime nono discovery, profile parsing, new sandbox backend, Windows enforcement, or network-domain policy.
- No denial of `~/.config/opencode` or required OpenCode provider-auth data, and no change to required runtime/cache/temp grants.
- No new reports directory, staging or host-mediated writer, exact report-path enforcement, MCP-specific filesystem exception, or change to Scout/Write/Build permissions.
- No logging of file contents, credential values, request payloads, or unredacted environment/configuration data.
- No claim that the extension-host log can recover a reason the underlying broker or OS never exposes; opaque errors remain documented as such.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-agent-sandbox`: extend the macOS/Linux protected-read baseline with reviewed credential leaves and require bounded, redacted extension-host diagnostics for sandbox and MCP failures when denial reasons are available.

## Impact

The primary implementation impact is `packages/platforms/vscode/src/chat-sandbox-policy.ts` and its focused policy tests, plus the existing sandbox diagnostic path in `packages/agents/opencode/src/opencode-agent.ts` and its tests. `SECURITY.md`, the relevant README documentation, and the `chat-agent-sandbox` delta specification will describe the new protected leaves and diagnostic logging. No dependency, configuration, protocol, OpenCode state-layout, MCP inventory, or independent TUI change is required.

## Risks and Fallback

The main compatibility risk is a local MCP or developer workflow that intentionally reads one of the newly protected credential leaves. Keep the additions narrow, surface the existing actionable failure, and retain the user-selected `off` mode as the explicit compatibility fallback; never remove a deny, broaden a grant, or retry unsandboxed. Diagnostic logging must remain bounded and redacted so improved troubleshooting does not create a new secret-exposure path.

## Compatibility Impact

On supported macOS/Linux sandbox launches, the listed credential leaves will be denied to the complete companion process tree, including local MCP descendants. Workspace reads and writes, required OpenCode state/config/auth access, executable/PATH dependencies, runtime caches, temporary paths, network behavior, MCP startup outside the protected leaves, and the existing Scout/Write agent boundaries remain unchanged when non-conflicting. Windows remains unchanged and makes no protected-read enforcement claim.
